"""Lakehouse Compass scan job (Lakeflow Jobs entry point).

The diagnostic is run PER WORKSPACE (--workspace_id, default = current). Every row
written carries workspace_id + workspace_name. History accrues: findings/scores/
cost/compliance/capabilities are APPENDED per (scan_id, workspace_id), and each run
appends one immutable snapshot row to scan_runs. Sources that fail resolve to
NOT_AVAILABLE (never fabricated).

Modes: --mode live (real read-only collectors) | --mode demo (offline fixtures).
Runs on serverless compute; compass_core is shipped alongside the bundle.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone


def _bootstrap_path() -> None:
    import glob

    candidates: list[str] = []
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        candidates += [os.path.join(here, "..", "..", "packages"), os.path.join(here, "..", "packages")]
    except NameError:
        pass
    candidates += glob.glob("/Workspace/Users/*/.bundle/lakehouse-compass/*/files/packages")
    candidates += glob.glob("/Workspace/**/lakehouse-compass/*/files/packages", recursive=True)
    candidates += ["./packages", "packages"]
    for c in candidates:
        if c and os.path.isdir(os.path.join(c, "compass_core")):
            sys.path.insert(0, os.path.abspath(c))
            return
    raise RuntimeError("compass_core package not found; searched: " + repr(candidates))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Lakehouse Compass scan")
    p.add_argument("--mode", default="live", choices=["demo", "live"])
    p.add_argument("--catalog", default="moi_ai_catalog")
    p.add_argument("--schema", default="lakehouse_compass")
    p.add_argument("--workspace_id", default=os.environ.get("DATABRICKS_WORKSPACE_ID", ""),
                   help="Single id, comma-separated list, or 'all' to scan billing-active workspaces.")
    p.add_argument("--window_days", type=int, default=30)
    p.add_argument("--all_workspaces", action="store_true",
                   help="Scan every billing-active workspace (capped by --max_workspaces).")
    p.add_argument("--max_workspaces", type=int, default=25,
                   help="Cap when scanning all workspaces, so discovery of thousands never runs unbounded.")
    known, _ = p.parse_known_args()
    return known


def _get_spark():
    from pyspark.sql import SparkSession  # type: ignore

    return SparkSession.builder.getOrCreate()


def _schemas():
    from pyspark.sql.types import (
        ArrayType, BooleanType, DoubleType, LongType, StringType, StructField, StructType,
    )

    S = lambda n, t=StringType(): StructField(n, t, True)  # noqa: E731
    return {
        "findings": StructType([
            S("finding_id"), S("rule_id"), S("domain"), S("title"), S("severity"),
            S("resource"), S("status"), S("framework_controls", ArrayType(StringType())),
            S("waf_pillars", ArrayType(StringType())),
            S("evidence_json"), S("remediation"), S("maintenance_task_id"),
            S("self_check", BooleanType()), S("scan_id"), S("workspace_id"),
            S("workspace_name"), S("detected_at"),
        ]),
        "scores": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("domain"),
            S("weight", LongType()), S("score", DoubleType()), S("findings", LongType()),
            S("critical_findings", LongType()), S("is_overall", BooleanType()),
            S("coverage_pct", DoubleType()), S("computed_at"),
        ]),
        "waf_scores": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("pillar"),
            S("score", DoubleType()), S("findings", LongType()),
            S("critical_findings", LongType()), S("rules", LongType()), S("computed_at"),
            # WAF Phase 2 — control-catalogue-grounded coverage + confidence band.
            S("controls_total", LongType()), S("controls_measured", LongType()),
            S("controls_passed", LongType()), S("low", DoubleType()), S("high", DoubleType()),
        ]),
        "waf_controls": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("pillar"), S("control_id"),
            S("principle"), S("title"), S("provenance"), S("measurability"), S("severity"),
            S("status"), S("measured", BooleanType()), S("rule_id"), S("remediation"), S("doc_url"),
        ]),
        "capabilities": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("capability_id"),
            S("source"), S("availability"), S("last_tested"),
        ]),
        "compliance_results": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("framework"),
            S("control_id"), S("title"), S("category"), S("status"),
            S("linked_findings", ArrayType(StringType())), S("computed_at"),
        ]),
        "cost_summary": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("product"), S("sku"),
            S("identity"), S("cost_usd", DoubleType()), S("dbus", DoubleType()), S("is_ai", BooleanType()),
        ]),
        "cost_detail": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("product"), S("sku"),
            S("identity"), S("resource_type"), S("resource_name"), S("owner"), S("tags_json"),
            S("cost_usd", DoubleType()), S("dbus", DoubleType()), S("records", LongType()),
        ]),
        "scan_runs": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("generated_at"),
            S("overall_score", DoubleType()), S("coverage_pct", DoubleType()),
            S("total_findings", LongType()), S("crit", LongType()), S("high", LongType()),
            S("med", LongType()), S("low", LongType()), S("domain_scores_json"),
            S("semantic_readiness", DoubleType()),
        ]),
        "workspaces": StructType([
            S("workspace_id"), S("workspace_name"), S("env_label"), S("discovered_via"),
        ]),
        "ai_estate_inventory": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("endpoint_name"),
            S("entity_type"), S("owner"), S("entity_name"),
        ]),
        "governance_metrics": StructType([
            S("scan_id"), S("workspace_id"), S("metric"), S("value", DoubleType()), S("detail"),
        ]),
        "perf_summary": StructType([
            S("scan_id"), S("workspace_id"), S("entity"), S("queries", LongType()),
            S("avg_ms", DoubleType()), S("max_ms", DoubleType()),
        ]),
        "compute_inventory": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("kind"), S("compute_id"),
            S("name"), S("size"), S("serverless", BooleanType()), S("auto_stop_min", LongType()),
            S("min_clusters", LongType()), S("max_clusters", LongType()), S("dbr_version"),
            S("state"), S("owner"), S("queries_30d", LongType()), S("avg_ms", DoubleType()),
            S("p90_ms", DoubleType()), S("dbus_30d", DoubleType()), S("cost_usd_30d", DoubleType()),
        ]),
        "usage_heatmap": StructType([
            S("scan_id"), S("workspace_id"), S("dow", LongType()), S("hour", LongType()), S("n", LongType()),
        ]),
        "usage_summary": StructType([
            S("scan_id"), S("workspace_id"), S("metric"), S("value", DoubleType()),
        ]),
        "usage_active_users_trend": StructType([
            S("scan_id"), S("workspace_id"), S("period_start"), S("active_users", LongType()), S("genie_users", LongType()),
        ]),
        "reliability_summary": StructType([
            S("scan_id"), S("workspace_id"), S("total_runs", LongType()), S("errors", LongType()),
            S("succeeded", LongType()), S("failure_rate_pct", DoubleType()),
        ]),
        "genie_inventory": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("space_id"), S("title"),
            S("has_description", BooleanType()), S("tables", LongType()),
        ]),
        "lakebase_inventory": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("name"), S("state"), S("capacity"),
        ]),
        "genie_readiness": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"),
            S("overall_score", DoubleType()), S("level", LongType()), S("level_label"),
            S("readiness_stage"), S("guidance"), S("top_gaps_json"),
            S("pillars_available", LongType()), S("pillars_total", LongType()), S("assessed_at"),
        ]),
        "genie_readiness_pillars": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("pillar_key"), S("name"),
            S("weight", LongType()), S("score", DoubleType()), S("technical_score", DoubleType()),
            S("level", LongType()), S("level_label"), S("available", BooleanType()),
            S("unavailable_reason"), S("signals_json"), S("gaps_json"), S("metrics_json"),
        ]),
        "genie_cost_summary": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("window_days", LongType()),
            S("billed_cost_usd", DoubleType()), S("billed_dbus", DoubleType()),
            S("free_dbus", DoubleType()), S("active_users", LongType()),
            S("code_free_dbus", DoubleType()), S("code_billed_dbus", DoubleType()),
            S("code_total_dbus", DoubleType()), S("code_billed_cost_usd", DoubleType()),
            S("code_users", LongType()),
            S("by_surface_json"), S("by_channel_json"), S("by_sku_json"), S("trend_json"),
        ]),
        "genie_cost_by_user": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("run_as_user"),
            S("genie_surface"), S("free_dbus", DoubleType()), S("paid_dbus", DoubleType()),
            S("billed_cost_usd", DoubleType()), S("free_allowance_limit", LongType()),
            S("over_allowance", BooleanType()),
        ]),
        "genie_cost_trend": StructType([
            S("scan_id"), S("workspace_id"), S("workspace_name"), S("usage_date"),
            S("billed_cost_usd", DoubleType()), S("billed_dbus", DoubleType()), S("free_dbus", DoubleType()),
        ]),
    }


def _write(spark, fq: str, name: str, rows: list[dict], mode: str = "append") -> None:
    if not rows:
        return
    schema = _schemas().get(name)
    if schema is not None:
        fields = [f.name for f in schema.fields]
        rows = [{k: r.get(k) for k in fields} for r in rows]
        df = spark.createDataFrame(rows, schema=schema)
    else:
        df = spark.createDataFrame(rows)
    writer = df.write.mode(mode)
    if mode == "overwrite":
        writer = writer.option("overwriteSchema", "true")
    else:
        writer = writer.option("mergeSchema", "true")
    writer.saveAsTable(f"{fq}.{name}")


def _resolve_workspace_id(spark, cli_value: str) -> str:
    if cli_value:
        return cli_value
    try:
        return str(spark.conf.get("spark.databricks.clusterUsageTags.clusterOwnerOrgId"))
    except Exception:
        return ""


def _label_env(name: str) -> str:
    n = (name or "").lower()
    for key in ("prod", "noprod", "staging", "sandbox", "dev", "demo", "test"):
        if key in n:
            return {"noprod": "non-prod"}.get(key, key)
    return "unknown"


def _discover_workspaces(spark):
    from compass_core.collectors.base import rows_as_dicts

    try:
        rows = rows_as_dicts(spark, "SELECT workspace_id, workspace_name FROM system.access.workspaces_latest")
        return {str(r["workspace_id"]): (r.get("workspace_name") or "") for r in rows}, "system.access.workspaces_latest"
    except Exception:
        try:
            rows = rows_as_dicts(spark, "SELECT DISTINCT workspace_id FROM system.billing.usage")
            return {str(r["workspace_id"]): "" for r in rows}, "system.billing.usage"
        except Exception:
            return {}, "none"


def _active_workspaces(spark, window_days: int) -> list[str]:
    """Workspaces with billing activity in the window, highest spend first."""
    from compass_core.collectors.base import rows_as_dicts

    try:
        rows = rows_as_dicts(
            spark,
            f"SELECT workspace_id, ROUND(SUM(usage_quantity), 0) AS q FROM system.billing.usage "
            f"WHERE usage_date >= DATEADD(DAY, -{window_days}, CURRENT_DATE()) "
            f"GROUP BY workspace_id ORDER BY q DESC",
        )
        return [str(r["workspace_id"]) for r in rows if r.get("workspace_id")]
    except Exception as e:
        print(f"[compass] active-workspace discovery failed: {str(e)[:160]}")
        return []


def _resolve_targets(spark, args, ws_map: dict, local_ws: str) -> list[str]:
    """Which workspaces to scan: explicit list, 'all'/--all_workspaces (billing-
    active, capped), or the local workspace by default."""
    raw = (args.workspace_id or "").strip()
    if getattr(args, "all_workspaces", False) or raw.lower() == "all":
        active = _active_workspaces(spark, args.window_days)
        pool = active or list(ws_map.keys())
        # The local workspace must always be scanned (Genie/adoption pillars are
        # local-only), so front-load it BEFORE the cap — this keeps it in the set
        # without letting the total exceed --max_workspaces by one.
        if local_ws:
            pool = [local_ws] + [w for w in pool if w != local_ws]
        return pool[: max(1, args.max_workspaces)]
    if "," in raw:
        return [x.strip() for x in raw.split(",") if x.strip()]
    if raw:
        return [raw]
    return [local_ws] if local_ws else (list(ws_map.keys())[:1] or [""])


def run_live(args) -> None:
    from compass_core.collectors import (
        FinOpsCollector, SecurityCollector, AiEstateCollector, GovernanceCollector,
        PerformanceCollector, UsageCollector, ReliabilityCollector,
        GenieCollector, GenieCostCollector, LakebaseCollector, GenieReadinessCollector,
    )
    from compass_core.collectors.base import cap
    from compass_core.capabilities.manager import PROBES
    from compass_core.compliance import ComplianceMapper, load_framework
    from compass_core.models.capability import Availability
    from compass_core.models.finding import Severity, Status
    from compass_core.models.rule import WafPillar
    from compass_core.rules import RuleRegistry
    from compass_core.scoring import attach_waf_pillars, overall_score
    from compass_core.waf import load_controls, assess as assess_waf

    spark = _get_spark()
    scan_id = "live-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    fq = f"{args.catalog}.{args.schema}"
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fq}")
    now = datetime.now(timezone.utc).isoformat()

    # ---- workspace discovery (written once) ----
    ws_map, disco_via = _discover_workspaces(spark)
    if ws_map:
        _write(spark, fq, "workspaces",
               [{"workspace_id": wid, "workspace_name": nm, "env_label": _label_env(nm), "discovered_via": disco_via}
                for wid, nm in sorted(ws_map.items(), key=lambda kv: kv[1])],
               mode="overwrite")

    # ---- SDK once. Genie + Lakebase APIs are scoped to the LOCAL workspace, so
    # they only run for local_ws; other workspaces get system-table domains only.
    rest = None
    owner_email = ""
    pg_connect = None
    local_ws = ""
    try:
        from databricks.sdk import WorkspaceClient  # type: ignore
        _w = WorkspaceClient()

        def rest(method, path, body=None):  # noqa: E306
            return _w.api_client.do(method, path, body=body)

        try:
            owner_email = _w.current_user.me().user_name or ""
        except Exception:
            owner_email = ""

        # Authoritative local workspace id (spark conf clusterOwnerOrgId is absent
        # on serverless, which would wrongly mark the local ws as remote).
        try:
            local_ws = str(_w.get_workspace_id())
        except Exception:
            local_ws = ""

        try:
            import ssl
            import uuid
            import pg8000.dbapi  # type: ignore

            _ctx = ssl.create_default_context()
            _ctx.check_hostname = False
            _ctx.verify_mode = ssl.CERT_NONE

            def pg_connect(dns, instance_name):  # noqa: E306
                cred = _w.api_client.do("POST", "/api/2.0/database/credentials",
                                        body={"instance_names": [instance_name], "request_id": str(uuid.uuid4())})
                token = cred.get("token")
                return pg8000.dbapi.connect(host=dns, port=5432, database="databricks_postgres",
                                            user=owner_email, password=token, ssl_context=_ctx, timeout=25)
        except Exception as e:
            print(f"[compass] pg driver unavailable: {str(e)[:140]}")
    except Exception as e:
        print(f"[compass] SDK REST unavailable in scan job: {str(e)[:160]}")

    # Fallbacks for the local workspace id: spark conf, then a single explicit
    # --workspace_id (a single-ws run targets the workspace the job runs in).
    if not local_ws:
        local_ws = _resolve_workspace_id(spark, "")
    if not local_ws:
        _raw = (args.workspace_id or "").strip()
        if _raw and "," not in _raw and _raw.lower() != "all":
            local_ws = _raw

    registry = RuleRegistry()
    rule_counts = {p.value: len(registry.by_waf_pillar(p.value)) for p in WafPillar}
    # WAF Phase 2: control catalogue loaded once; per-workspace assessment uses the
    # scan's open findings + usable capabilities to mark each control measured/gap/pass.
    waf_catalogue = load_controls()
    known_rule_ids = {r.id for r in registry.all()}
    rule_requires = {r.id: list(r.requires) for r in registry.all()}

    targets = _resolve_targets(spark, args, ws_map, local_ws)
    print(f"[compass] scanning {len(targets)} workspace(s): {targets} (local={local_ws})")

    def _scan_one(ws: str, ws_name: str, is_local: bool) -> None:
        findings: list = []
        capabilities: list = []

        fin = FinOpsCollector(workspace_id=ws, window_days=args.window_days, scan_id=scan_id, workspace_name=ws_name).collect(spark)
        findings += fin.findings
        capabilities += fin.capabilities
        cost_rows = fin.inventory.get("cost_summary", [])
        cost_detail_rows = fin.inventory.get("cost_detail", [])

        # Genie cost & consumption — billing.usage (GENIE), runs for every ws.
        gcost = GenieCostCollector(workspace_id=ws, window_days=args.window_days, scan_id=scan_id, workspace_name=ws_name).collect(spark)
        findings += gcost.findings
        capabilities += gcost.capabilities
        genie_cost_summary = gcost.inventory.get("genie_cost_summary", [])
        genie_cost_by_user = gcost.inventory.get("genie_cost_by_user", [])
        genie_cost_trend = gcost.inventory.get("genie_cost_trend", [])

        sec = SecurityCollector(scan_id=scan_id, workspace_id=ws, workspace_name=ws_name).collect(spark)
        findings += sec.findings
        capabilities += sec.capabilities

        aie = AiEstateCollector(workspace_id=ws, scan_id=scan_id, workspace_name=ws_name).collect(spark)
        findings += aie.findings
        capabilities += aie.capabilities
        ai_inv = aie.inventory.get("ai_estate_inventory", [])

        gov = GovernanceCollector(catalog=args.catalog, workspace_id=ws, scan_id=scan_id, workspace_name=ws_name).collect(spark)
        findings += gov.findings
        capabilities += gov.capabilities
        gov_metrics = gov.inventory.get("governance_metrics", [])
        semantic_readiness = gov.semantic_readiness

        # Warehouse config comes from the SDK REST API (local workspace only, like
        # Genie/Lakebase); clusters/cost/utilization come from system tables for any ws.
        perf = PerformanceCollector(workspace_id=ws, scan_id=scan_id, workspace_name=ws_name,
                                    rest=(rest if is_local else None)).collect(spark)
        findings += perf.findings
        capabilities += perf.capabilities
        perf_summary = perf.inventory.get("perf_summary", [])
        compute_inventory = perf.inventory.get("compute_inventory", [])

        usg = UsageCollector(workspace_id=ws, scan_id=scan_id, workspace_name=ws_name).collect(spark)
        findings += usg.findings
        capabilities += usg.capabilities
        usage_heatmap = usg.inventory.get("usage_heatmap", [])
        usage_summary = usg.inventory.get("usage_summary", [])
        usage_active_users_trend = usg.inventory.get("usage_active_users_trend", [])

        rel = ReliabilityCollector(workspace_id=ws, scan_id=scan_id, workspace_name=ws_name).collect(spark)
        findings += rel.findings
        capabilities += rel.capabilities
        reliability_summary = rel.inventory.get("reliability_summary", [])

        genie_inventory: list = []
        lakebase_inventory: list = []
        genie_readiness: list = []
        genie_readiness_pillars: list = []
        if is_local:
            gen = GenieCollector(rest, workspace_id=ws, scan_id=scan_id, workspace_name=ws_name).collect()
            findings += gen.findings
            capabilities += gen.capabilities
            genie_inventory = gen.inventory.get("genie_inventory", [])

            lkb = LakebaseCollector(rest, workspace_id=ws, scan_id=scan_id, workspace_name=ws_name,
                                    pg_connect=pg_connect, owner_email=owner_email).collect()
            findings += lkb.findings
            capabilities += lkb.capabilities
            lakebase_inventory = lkb.inventory.get("lakebase_inventory", [])

            # Genie Ontology Readiness — UC-metadata pillars are metastore-wide;
            # genie/adoption pillars are scoped to this (local) workspace's audit.
            gr = GenieReadinessCollector(workspace_id=ws, scan_id=scan_id, workspace_name=ws_name).collect(spark)
            findings += gr.findings
            capabilities += gr.capabilities
            genie_readiness = gr.inventory.get("genie_readiness", [])
            genie_readiness_pillars = gr.inventory.get("genie_readiness_pillars", [])

        # probe remaining sources; NOT_AVAILABLE on failure (no faking)
        covered = {c.id for c in capabilities}
        probe_sql = {
            "query": "SELECT 1 FROM system.query.history LIMIT 1",
            "lakeflow": "SELECT 1 FROM system.lakeflow.jobs LIMIT 1",
            "compute": "SELECT 1 FROM system.compute.clusters LIMIT 1",
            "serving": "SELECT 1 FROM system.serving.endpoint_usage LIMIT 1",
            "ai_gateway": "SELECT 1 FROM system.serving.served_entities LIMIT 1",
        }
        for cap_id, q in probe_sql.items():
            if cap_id in covered:
                continue
            try:
                spark.sql(q).collect()
                capabilities.append(cap(cap_id, PROBES.get(cap_id, {}).get("source", cap_id), Availability.AVAILABLE))
            except Exception as e:
                capabilities.append(cap(cap_id, PROBES.get(cap_id, {}).get("source", cap_id), Availability.NOT_AVAILABLE, str(e)[:200]))
        # Genie/Lakebase APIs are local-only → NOT_AVAILABLE for remote workspaces.
        remote_na = {} if is_local else {
            "genie": ("genie_api", "Genie API is scoped to the local workspace; not scanned for remote workspaces."),
            "lakebase_instances": ("database_instances_api", "Lakebase API is scoped to the local workspace."),
        }
        for cap_id, (src, reason) in {
            "lakebase": ("pg_roles/pg_stat", "Requires a read-only Postgres role granted to Compass; not introspectable from the scan job."),
            "mcp_catalog": ("mcp_catalog", "MCP Catalog API not enabled / preview in this workspace."),
            "sat": ("security_analysis.results", "Depends on the customer running the Security Analysis Tool (SAT)."),
            **remote_na,
        }.items():
            if cap_id not in covered:
                capabilities.append(cap(cap_id, src, Availability.NOT_AVAILABLE, reason))

        # de-duplicate capabilities by id (collectors + probes may overlap); last wins.
        _capmap = {c.id: c for c in capabilities}
        caps = list(_capmap.values())

        usable = sum(1 for c in caps if c.is_usable)
        coverage = round(100.0 * usable / len(caps), 1) if caps else 0.0

        attach_waf_pillars(findings, registry)
        score = overall_score(findings, coverage_pct=coverage, scan_id=scan_id, rule_counts=rule_counts)

        evaluated_rule_ids = {f.rule_id for f in findings}
        compliance_rows: list[dict] = []
        for fwname in ("dbx-security-best-practices", "ai-governance-baseline"):
            fw = load_framework(fwname)
            for r in ComplianceMapper(fw).evaluate(findings, evaluated_rule_ids=evaluated_rule_ids):
                compliance_rows.append({
                    "scan_id": scan_id, "workspace_id": ws, "workspace_name": ws_name,
                    "framework": fw.framework, "control_id": r.control_id, "title": r.title,
                    "category": r.category, "status": r.status.value,
                    "linked_findings": r.linked_findings or [], "computed_at": now,
                })

        def sev_count(s: Severity) -> int:
            return sum(1 for f in findings if f.severity == s)

        # ---- writes (append for history) ----
        _write(spark, fq, "findings", [f.to_row() for f in findings])

        score_rows = [
            {"scan_id": scan_id, "workspace_id": ws, "workspace_name": ws_name, "domain": d.domain,
             "weight": d.weight, "score": float(d.score), "findings": d.findings,
             "critical_findings": d.critical_findings, "is_overall": False,
             "coverage_pct": float(coverage), "computed_at": now}
            for d in score.domains
        ]
        score_rows.append(
            {"scan_id": scan_id, "workspace_id": ws, "workspace_name": ws_name, "domain": "OVERALL",
             "weight": 100, "score": float(score.overall),
             "findings": sum(d.findings for d in score.domains),
             "critical_findings": sum(d.critical_findings for d in score.domains),
             "is_overall": True, "coverage_pct": float(coverage), "computed_at": now}
        )
        _write(spark, fq, "scores", score_rows)

        # WAF Phase 2 — assess the control catalogue against this scan (open findings
        # + usable capabilities) to derive per-pillar control coverage + confidence band.
        usable_caps = {c.id for c in caps if c.is_usable}
        open_rule_ids = {f.rule_id for f in findings if f.status == Status.OPEN}
        waf_assess = assess_waf(waf_catalogue, open_rule_ids, known_rule_ids, rule_requires, usable_caps)

        _write(spark, fq, "waf_scores",
               [{"scan_id": scan_id, "workspace_id": ws, "workspace_name": ws_name, "pillar": p.pillar,
                 "score": float(p.score), "findings": p.findings, "critical_findings": p.critical_findings,
                 "rules": p.rules, "computed_at": now,
                 "controls_total": int(waf_assess[p.pillar].total) if p.pillar in waf_assess else 0,
                 "controls_measured": int(waf_assess[p.pillar].measured) if p.pillar in waf_assess else 0,
                 "controls_passed": int(waf_assess[p.pillar].passed) if p.pillar in waf_assess else 0,
                 "low": float(waf_assess[p.pillar].low) if p.pillar in waf_assess else 0.0,
                 "high": float(waf_assess[p.pillar].high) if p.pillar in waf_assess else 0.0}
                for p in score.waf_pillars])

        waf_control_rows = []
        for pillar_slug, a in waf_assess.items():
            for o in a.outcomes:
                c = o.control
                waf_control_rows.append({
                    "scan_id": scan_id, "workspace_id": ws, "workspace_name": ws_name,
                    "pillar": pillar_slug, "control_id": c.id, "principle": c.principle,
                    "title": c.title, "provenance": c.provenance, "measurability": c.measurability,
                    "severity": c.severity, "status": o.status, "measured": bool(o.measured),
                    "rule_id": c.rule or "", "remediation": c.remediation, "doc_url": c.doc_url,
                })
        _write(spark, fq, "waf_controls", waf_control_rows)

        _write(spark, fq, "capabilities",
               [{"scan_id": scan_id, "workspace_id": ws, "workspace_name": ws_name,
                 "capability_id": c.id, "source": c.source, "availability": c.availability.value, "last_tested": now}
                for c in caps])

        _write(spark, fq, "compliance_results", compliance_rows)

        if ai_inv:
            _write(spark, fq, "ai_estate_inventory", ai_inv)
        if gov_metrics:
            _write(spark, fq, "governance_metrics", gov_metrics)
        if perf_summary:
            _write(spark, fq, "perf_summary", perf_summary)
        if compute_inventory:
            _write(spark, fq, "compute_inventory", compute_inventory)
        if usage_heatmap:
            _write(spark, fq, "usage_heatmap", usage_heatmap)
        if usage_summary:
            _write(spark, fq, "usage_summary", usage_summary)
        if usage_active_users_trend:
            _write(spark, fq, "usage_active_users_trend", usage_active_users_trend)
        if reliability_summary:
            _write(spark, fq, "reliability_summary", reliability_summary)
        if genie_inventory:
            _write(spark, fq, "genie_inventory", genie_inventory)
        if lakebase_inventory:
            _write(spark, fq, "lakebase_inventory", lakebase_inventory)
        if genie_readiness:
            _write(spark, fq, "genie_readiness", genie_readiness)
        if genie_readiness_pillars:
            _write(spark, fq, "genie_readiness_pillars", genie_readiness_pillars)
        if genie_cost_summary:
            _write(spark, fq, "genie_cost_summary", genie_cost_summary)
        if genie_cost_by_user:
            _write(spark, fq, "genie_cost_by_user", genie_cost_by_user)
        if genie_cost_trend:
            _write(spark, fq, "genie_cost_trend", genie_cost_trend)

        _write(spark, fq, "cost_summary",
               [{"scan_id": scan_id, "workspace_id": r.get("workspace_id") or ws,
                 "workspace_name": r.get("workspace_name") or ws_name, "product": r.get("product"),
                 "sku": r.get("sku"), "identity": r.get("identity"),
                 "cost_usd": float(r.get("cost_usd") or 0.0), "dbus": float(r.get("dbus") or 0.0),
                 "is_ai": bool(r.get("is_ai"))}
                for r in cost_rows])

        if cost_detail_rows:
            _write(spark, fq, "cost_detail",
                   [{"scan_id": scan_id, "workspace_id": r.get("workspace_id") or ws,
                     "workspace_name": r.get("workspace_name") or ws_name, "product": r.get("product"),
                     "sku": r.get("sku"), "identity": r.get("identity"), "resource_type": r.get("resource_type"),
                     "resource_name": r.get("resource_name"), "owner": r.get("owner"), "tags_json": r.get("tags_json"),
                     "cost_usd": float(r.get("cost_usd") or 0.0), "dbus": float(r.get("dbus") or 0.0),
                     "records": int(r.get("records") or 0)}
                    for r in cost_detail_rows])

        domain_scores_json = json.dumps({d.domain: d.score for d in score.domains})
        _write(spark, fq, "scan_runs",
               [{"scan_id": scan_id, "workspace_id": ws, "workspace_name": ws_name, "generated_at": now,
                 "overall_score": float(score.overall), "coverage_pct": float(coverage),
                 "total_findings": len(findings), "crit": sev_count(Severity.CRITICAL),
                 "high": sev_count(Severity.HIGH), "med": sev_count(Severity.MEDIUM),
                 "low": sev_count(Severity.LOW), "domain_scores_json": domain_scores_json,
                 "semantic_readiness": float(semantic_readiness) if semantic_readiness is not None else None}])

        print(f"[compass] scan {scan_id} ws={ws}({ws_name}) local={is_local}: score={score.overall} "
              f"coverage={coverage}% findings={len(findings)} cost_rows={len(cost_rows)} -> {fq}.*")
        print("[compass] capabilities: " + json.dumps({c.id: c.availability.value for c in caps}))

    for tws in targets:
        try:
            _scan_one(tws, ws_map.get(tws, ""), is_local=(tws == local_ws))
        except Exception as e:
            print(f"[compass] ERROR scanning ws={tws}: {str(e)[:240]}")

    print(f"[compass] LIVE scan {scan_id} complete: {len(targets)} workspace(s); discovered={len(ws_map)} via={disco_via}")


def run_demo(args) -> None:
    from compass_core.demo import demo_scan

    scan = demo_scan()
    fq = f"{args.catalog}.{args.schema}"
    try:
        spark = _get_spark()
    except Exception:
        print(f"[compass] DEMO dry-run: score={scan['overall_score']} coverage={scan['coverage_pct']}% findings={len(scan['findings'])}")
        return
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fq}")
    _write(spark, fq, "findings", scan["findings"], mode="overwrite")
    print(f"[compass] DEMO scan {scan['scan_id']} written to {fq}.findings")


def main() -> None:
    args = parse_args()
    _bootstrap_path()
    if args.mode == "live":
        run_live(args)
    else:
        run_demo(args)


if __name__ == "__main__":
    main()
