"""Security collector (spec §6.A).

Reads system.information_schema privilege tables to detect broad grants to
all-account-users groups — a real least-privilege problem. Produces:
  - SEC-014 (MODIFY / ALL PRIVILEGES to `account users`),
  - SEC-030 (APPLY TAG granted broadly — a governed-tag / ABAC boundary).
"""

from __future__ import annotations

from ..models.capability import Availability
from ..models.finding import Finding, Severity
from .base import CollectorResult, SparkLike, cap, rows_as_dicts

_BROAD = ("account users", "users", "All account users")
_BROAD_SQL = "('account users','users','All account users')"


class SecurityCollector:
    domain = "security"

    def __init__(self, scan_id: str = "live", workspace_id: str = "", workspace_name: str = ""):
        self.scan_id = scan_id
        self.workspace_id = workspace_id
        self.workspace_name = workspace_name

    def collect(self, spark: SparkLike) -> CollectorResult:
        res = CollectorResult()
        try:
            cat = rows_as_dicts(
                spark,
                f"""
                SELECT grantee, privilege_type, COUNT(*) AS n
                FROM system.information_schema.catalog_privileges
                WHERE grantee IN {_BROAD_SQL}
                GROUP BY 1, 2
                """,
            )
            sch = rows_as_dicts(
                spark,
                f"""
                SELECT grantee, privilege_type, COUNT(*) AS n
                FROM system.information_schema.schema_privileges
                WHERE grantee IN {_BROAD_SQL}
                GROUP BY 1, 2
                """,
            )
            res.capabilities.append(
                cap("tags", "system.information_schema", Availability.AVAILABLE)
            )
            res.capabilities.append(
                cap("access", "system.information_schema", Availability.AVAILABLE)
            )
        except Exception as e:  # pragma: no cover - depends on live grants
            res.capabilities.append(
                cap("tags", "system.information_schema", Availability.NOT_AVAILABLE, str(e)[:300])
            )
            return res

        def count_of(rows: list[dict], privs: tuple[str, ...]) -> int:
            return sum(int(r["n"]) for r in rows if r["privilege_type"] in privs)

        # SEC-014 — broad MODIFY / ALL PRIVILEGES.
        broad_privs = ("ALL_PRIVILEGES", "MODIFY")
        cat_broad = count_of(cat, broad_privs)
        sch_broad = count_of(sch, broad_privs)
        if cat_broad + sch_broad > 0:
            res.findings.append(
                Finding(
                    id=f"{self.scan_id}-SEC-014",
                    rule_id="SEC-014",
                    domain="security",
                    title="Broad MODIFY / ALL PRIVILEGES granted to all-account-users",
                    severity=Severity.CRITICAL if cat_broad > 0 else Severity.HIGH,
                    resource="grantee: account users",
                    evidence={
                        "catalog_grants": cat_broad,
                        "schema_grants": sch_broad,
                        "detail": [r for r in (cat + sch) if r["privilege_type"] in broad_privs][:10],
                    },
                    remediation="REVOKE the broad privilege from `account users`; grant scoped access to specific teams.",
                    framework_controls=["DBX-SBP:IAM-3", "CIS:1.1", "ISO27001:A.5.15"],
                    scan_id=self.scan_id,
                )
            )

        # SEC-030 — APPLY TAG granted broadly (ABAC boundary).
        cat_tag = count_of(cat, ("APPLY_TAG",))
        sch_tag = count_of(sch, ("APPLY_TAG",))
        if cat_tag + sch_tag > 0:
            res.findings.append(
                Finding(
                    id=f"{self.scan_id}-SEC-030",
                    rule_id="SEC-030",
                    domain="security",
                    title="APPLY TAG granted broadly to all-account-users (ABAC boundary)",
                    severity=Severity.HIGH,
                    resource="grantee: account users",
                    evidence={"catalog_apply_tag": cat_tag, "schema_apply_tag": sch_tag},
                    remediation="Restrict APPLY TAG to the data-governance stewardship group.",
                    framework_controls=["DBX-SBP:GOV-1", "ISO27001:A.8.3"],
                    scan_id=self.scan_id,
                )
            )

        for f in res.findings:
            f.workspace_id = self.workspace_id
            f.workspace_name = self.workspace_name
        return res
