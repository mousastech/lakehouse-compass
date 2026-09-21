"""Lakehouse Compass proactive digest job (autonomous-cadence roadmap, D18).

Runs AFTER a scan (or on its own schedule). Reads the last two scans for a
workspace from Delta, builds a plain-language status digest (compass_core.digest)
and appends it to moi_ai_catalog.lakehouse_compass.digests. If COMPASS_SLACK_WEBHOOK
is set, it also posts the narrative to Slack. It never executes remediation.

Modes mirror the scan job: --workspace_id (default = current), --catalog/--schema.
Runs on serverless; compass_core ships alongside the bundle.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
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
    p = argparse.ArgumentParser(description="Lakehouse Compass digest")
    p.add_argument("--catalog", default="moi_ai_catalog")
    p.add_argument("--schema", default="lakehouse_compass")
    p.add_argument("--workspace_id", default=os.environ.get("DATABRICKS_WORKSPACE_ID", ""))
    known, _ = p.parse_known_args()
    return known


def _get_spark():
    from pyspark.sql import SparkSession  # type: ignore

    return SparkSession.builder.getOrCreate()


def _resolve_workspace_id(spark, cli_value: str) -> str:
    if cli_value:
        return cli_value
    try:
        return str(spark.conf.get("spark.databricks.clusterUsageTags.clusterOwnerOrgId"))
    except Exception:
        return ""


def _rows(spark, sql: str) -> list[dict]:
    return [r.asDict(recursive=True) for r in spark.sql(sql).collect()]


def _post_slack(webhook: str, text: str) -> bool:
    try:
        req = urllib.request.Request(
            webhook,
            data=json.dumps({"text": text}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return 200 <= resp.status < 300
    except Exception as e:
        print(f"[compass] Slack push failed: {str(e)[:160]}")
        return False


def main() -> None:
    args = parse_args()
    _bootstrap_path()
    from compass_core.digest import build_digest, narrative

    spark = _get_spark()
    fq = f"{args.catalog}.{args.schema}"
    ws = _resolve_workspace_id(spark, args.workspace_id)
    ws_filter = f"workspace_id = '{ws}'" if ws else "1=1"
    now = datetime.now(timezone.utc).isoformat()

    # Last two immutable snapshots for this workspace (newest first).
    runs = _rows(
        spark,
        f"SELECT * FROM {fq}.scan_runs WHERE {ws_filter} ORDER BY generated_at DESC LIMIT 2",
    )
    if not runs:
        print(f"[compass] no scan_runs for ws={ws}; nothing to digest.")
        return
    current = runs[0]
    previous = runs[1] if len(runs) > 1 else None
    cur_scan = current.get("scan_id")
    prev_scan = previous.get("scan_id") if previous else None
    ws_name = current.get("workspace_name") or ""

    waf_pillars = _rows(spark, f"SELECT pillar, score, findings, critical_findings, rules "
                               f"FROM {fq}.waf_scores WHERE scan_id = '{cur_scan}'")

    cur_rule_ids = {r["rule_id"] for r in _rows(
        spark, f"SELECT DISTINCT rule_id FROM {fq}.findings WHERE scan_id = '{cur_scan}' AND status = 'open'")}
    prev_rule_ids: set[str] = set()
    if prev_scan:
        prev_rule_ids = {r["rule_id"] for r in _rows(
            spark, f"SELECT DISTINCT rule_id FROM {fq}.findings WHERE scan_id = '{prev_scan}' AND status = 'open'")}

    criticals = _rows(
        spark,
        f"SELECT rule_id, title, resource FROM {fq}.findings "
        f"WHERE scan_id = '{cur_scan}' AND status = 'open' AND severity = 'critical' LIMIT 20",
    )

    digest = build_digest(
        workspace_name=ws_name, current=current, previous=previous,
        waf_pillars=waf_pillars, current_rule_ids=cur_rule_ids,
        previous_rule_ids=prev_rule_ids, criticals=criticals,
    )
    text = narrative(digest)
    print("[compass] digest:\n" + text)

    webhook = os.environ.get("COMPASS_SLACK_WEBHOOK", "").strip()
    pushed = _post_slack(webhook, text) if webhook else False
    push_target = "slack" if webhook else ""

    row = {
        "digest_id": "digest-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
        "scan_id": cur_scan, "prev_scan_id": prev_scan, "workspace_id": ws, "workspace_name": ws_name,
        "generated_at": now, "score": float(digest["score"]),
        "score_delta": None if digest["score_delta"] is None else float(digest["score_delta"]),
        "coverage_pct": float(digest["coverage_pct"]),
        "crit": digest["severity_counts"]["critical"], "high": digest["severity_counts"]["high"],
        "med": digest["severity_counts"]["medium"], "low": digest["severity_counts"]["low"],
        "weakest_pillars_json": json.dumps(digest["weakest_pillars"]),
        "limited_pillars_json": json.dumps(digest["limited_coverage_pillars"]),
        "new_json": json.dumps(digest["changes"]["new"]),
        "resolved_json": json.dumps(digest["changes"]["resolved"]),
        "still_open_json": json.dumps(digest["changes"]["still_open"]),
        "criticals_json": json.dumps(digest["criticals"]),
        "narrative": text, "pushed": pushed, "push_target": push_target,
    }
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fq}")
    spark.createDataFrame([row]).write.mode("append").option("mergeSchema", "true").saveAsTable(f"{fq}.digests")
    print(f"[compass] digest {row['digest_id']} ws={ws}({ws_name}) score={digest['score']} "
          f"delta={digest['score_delta']} pushed={pushed} -> {fq}.digests")


if __name__ == "__main__":
    main()
