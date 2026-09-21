"""Lakebase collector (spec §6.F) — runs in the scan job.

- Database Instances API (needs no Postgres role): inventory + LKB-003 (running/
  scale-to-zero) + LKB-001 (native password auth, from enable_pg_native_login).
- pg-introspection (LKB-002 privileged roles, LKB-006 tenant tables without RLS)
  via a psycopg connection when `pg_connect` is provided (the customer authorized
  a read-only role). If pg is unreachable, those checks resolve NOT_AVAILABLE
  with the reason and `lakebase` capability stays NOT_AVAILABLE.
"""

from __future__ import annotations

from typing import Callable, Optional

from ..models.capability import Availability
from ..models.finding import Finding, Severity
from .base import CollectorResult, cap

PG_GRANT_STEPS = (
    "Read-only Postgres role for the Compass SP (CREATE ROLE + GRANT CONNECT + GRANT USAGE ON SCHEMA public); "
    "requires the instance running."
)


class LakebaseCollector:
    domain = "lakebase"

    def __init__(
        self,
        rest: Optional[Callable[..., dict]],
        workspace_id: str,
        scan_id: str = "live",
        workspace_name: str = "",
        pg_connect: Optional[Callable[[str, str], object]] = None,
        owner_email: str = "",
    ):
        self.rest = rest
        self.workspace_id = workspace_id
        self.workspace_name = workspace_name
        self.scan_id = scan_id
        self.pg_connect = pg_connect
        self.owner_email = owner_email

    def _f(self, rid, title, sev, resource, evidence, remediation, controls=None):
        return Finding(
            id=f"{self.scan_id}-{rid}-{resource[:24]}",
            rule_id=rid, domain="lakebase", title=title, severity=sev, resource=resource,
            evidence=evidence, remediation=remediation, framework_controls=controls or [],
            scan_id=self.scan_id, workspace_id=self.workspace_id, workspace_name=self.workspace_name,
        )

    def collect(self, _spark=None) -> CollectorResult:
        res = CollectorResult()
        if self.rest is None:
            res.capabilities.append(cap("lakebase_instances", "database_instances_api", Availability.NOT_AVAILABLE, "No API credentials in the scan job."))
            res.capabilities.append(cap("lakebase", "pg_roles/pg_stat", Availability.NOT_AVAILABLE, PG_GRANT_STEPS))
            return res
        try:
            d = self.rest("GET", "/api/2.0/database/instances") or {}
            instances = d.get("database_instances", []) or []
            res.capabilities.append(cap("lakebase_instances", "database_instances_api", Availability.AVAILABLE))
        except Exception as e:  # pragma: no cover
            res.capabilities.append(cap("lakebase_instances", "database_instances_api", Availability.NOT_AVAILABLE, str(e)[:200]))
            res.capabilities.append(cap("lakebase", "pg_roles/pg_stat", Availability.NOT_AVAILABLE, PG_GRANT_STEPS))
            return res

        inv = [{"scan_id": self.scan_id, "workspace_id": self.workspace_id, "workspace_name": self.workspace_name,
                "name": str(i.get("name") or ""), "state": str(i.get("state") or ""), "capacity": str(i.get("capacity") or "")}
               for i in instances]
        res.inventory["lakebase_inventory"] = inv

        running = [i for i in instances if str(i.get("state")) in ("AVAILABLE", "RUNNING", "STARTING")]
        if running:
            res.findings.append(self._f("LKB-003", "Lakebase instances running — verify scale-to-zero on non-production",
                                        Severity.LOW, ",".join(str(i.get("name")) for i in running),
                                        {"running": [f"{i.get('name')}:{i.get('capacity')}" for i in running]},
                                        "Enable scale-to-zero on non-production Lakebase compute; stop idle instances."))

        pg_ok = False
        pg_err = ""
        for i in running:
            name = str(i.get("name") or "")
            dns = str(i.get("read_write_dns") or "")
            # LKB-001: native password auth (from instance config, no pg needed).
            if i.get("enable_pg_native_login"):
                res.findings.append(self._f("LKB-001", "Native password authentication enabled on Lakebase project",
                                            Severity.HIGH, f"lakebase: {name}", {"enable_pg_native_login": True},
                                            "Disable native password auth; use OAuth tokens.", ["DBX-SBP:IAM-7", "SOC2:CC6.1"]))
            if not self.pg_connect or not dns:
                continue
            conn = None
            try:
                conn = self.pg_connect(dns, name)
                cur = conn.cursor()
                # LKB-002: roles with superuser / createrole / createdb (excluding pg_* and the owner).
                cur.execute("SELECT rolname, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles "
                            "WHERE (rolsuper OR rolcreaterole OR rolcreatedb) AND rolname NOT LIKE 'pg\\_%'")
                priv = [{"role": r[0], "super": r[1], "createrole": r[2], "createdb": r[3]} for r in cur.fetchall()
                        if r[0] != self.owner_email]
                if priv:
                    res.findings.append(self._f("LKB-002", "Lakebase roles with elevated (owner/superuser/createrole) privileges",
                                                Severity.HIGH if any(p["super"] for p in priv) else Severity.MEDIUM,
                                                f"lakebase: {name}", {"privileged_roles": priv[:12]},
                                                "Scope roles to least privilege; no SUPERUSER/CREATEROLE for app/agent roles.", ["DBX-SBP:IAM-3"]))
                # LKB-006: tables with tenant_id/workspace_id column and no row-level security.
                cur.execute("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid "
                            "WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema') "
                            "AND c.relrowsecurity=false AND EXISTS (SELECT 1 FROM information_schema.columns col "
                            "WHERE col.table_schema=n.nspname AND col.table_name=c.relname AND col.column_name IN ('tenant_id','workspace_id'))")
                norls = [r[0] for r in cur.fetchall()]
                if norls:
                    res.findings.append(self._f("LKB-006", "Multi-tenant Lakebase tables without row-level security",
                                                Severity.HIGH, f"lakebase: {name}", {"tables_without_rls": norls[:20]},
                                                "Enable ROW LEVEL SECURITY and add tenant/workspace row-filter policies.", ["DBX-SBP:DATA-3"]))
                pg_ok = True
                cur.close()
            except Exception as e:  # pragma: no cover
                pg_err = str(e)[:180]
            finally:
                try:
                    if conn:
                        conn.close()
                except Exception:
                    pass

        if pg_ok:
            res.capabilities.append(cap("lakebase", "pg_roles/pg_policies", Availability.AVAILABLE))
        else:
            reason = f"pg connect failed: {pg_err}" if pg_err else (PG_GRANT_STEPS if not self.pg_connect else "no running instances to introspect")
            res.capabilities.append(cap("lakebase", "pg_roles/pg_policies", Availability.NOT_AVAILABLE, reason))
        return res
