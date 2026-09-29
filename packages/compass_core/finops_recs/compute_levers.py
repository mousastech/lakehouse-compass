"""Compute cost levers that need per-resource measurement SQL.

Unlike ``builder.py`` (pure over already-collected inventory), these levers
reconstruct a physical quantity from raw System Tables — inter-query warm gaps
for warehouses, per-minute CPU idle for clusters, job runtime share for
all-purpose clusters — so they take a live ``spark``. They are still priced by
the pure, unit-tested functions in ``savings.py``; the SQL only *measures*.

Every lever is defensive per resource: a failed query skips that resource and
never raises, and the ``min_observation_days`` / recency guards suppress
too-new or already-stopped resources (you cannot save on a resource no longer
running). Resources are few per workspace, so a small query per resource is
cheap and keeps each measurement auditable.

Levers:
* FIN-102 warehouse_autostop (classic/PRO)   — estimated / medium
* FIN-103 warehouse_autostop_serverless      — bookable  / high
* FIN-101 cluster_autotermination            — bookable  / high
* FIN-105 interactive_to_job                  — estimated / medium (fallback path)
"""

from __future__ import annotations

from typing import Any

from .model import Recommendation
from .savings import (
    THRESHOLDS,
    cluster_autotermination_savings,
    interactive_to_job_savings,
    savings_priority,
    warehouse_autostop_savings,
    warehouse_autostop_serverless_savings,
)


def _one(spark: Any, sql: str) -> dict[str, Any]:
    rows = [r.asDict(recursive=True) for r in spark.sql(sql).collect()]
    return rows[0] if rows else {}


def _num(v: Any) -> float:
    try:
        return float(v or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _warehouse_gap_sql(ws: str, wid: str, cur_sec: int, target_sec: int, win: int) -> str:
    # Per-query warm gaps: after a query the warehouse stays warm up to its
    # auto-stop, then stops. Reclaimable warm = warm-at-current minus warm-at-target.
    return f"""
    WITH q AS (
      SELECT start_time, end_time,
             LEAD(start_time) OVER (ORDER BY start_time) AS next_start,
             total_duration_ms
      FROM system.query.history
      WHERE workspace_id='{ws}' AND compute.warehouse_id='{wid}'
        AND start_time >= DATEADD(DAY, -{win}, CURRENT_DATE())
    ), g AS (
      SELECT total_duration_ms,
             CASE WHEN next_start > end_time
                  THEN unix_timestamp(next_start) - unix_timestamp(end_time) ELSE 0 END AS gap_sec,
             to_date(start_time) AS d
      FROM q
    )
    SELECT
      SUM(total_duration_ms)/60000.0 AS active_min,
      SUM(LEAST(gap_sec, {cur_sec}))/60.0 AS warm_min,
      SUM(GREATEST(0, LEAST(gap_sec, {cur_sec}) - {target_sec}))/60.0 AS reclaim_min,
      SUM(CASE WHEN gap_sec > {target_sec} AND gap_sec <= {cur_sec} THEN 1 ELSE 0 END) AS extra_stops,
      COUNT(DISTINCT d) AS observed_days
    FROM g
    """


def _cluster_idle_sql(ws: str, cid: str, win: int, idle_cpu: float) -> str:
    # Per-minute CPU averaged across nodes; a minute below idle_cpu is idle.
    return f"""
    WITH m AS (
      SELECT date_trunc('minute', start_time) AS t,
             AVG(cpu_user_percent + cpu_system_percent) AS cpu
      FROM system.compute.node_timeline
      WHERE cluster_id='{cid}' AND start_time >= DATEADD(DAY, -{win}, CURRENT_DATE())
      GROUP BY 1
    )
    SELECT COUNT(*) AS total_min,
           SUM(CASE WHEN cpu < {idle_cpu} THEN 1 ELSE 0 END) AS idle_min,
           COUNT(DISTINCT to_date(t)) AS observed_days
    FROM m
    """


def _job_share_sql(cid: str, win: int) -> str:
    return f"""
    SELECT COUNT(DISTINCT job_id) AS njobs, COUNT(DISTINCT run_id) AS nruns,
           SUM(execution_duration_seconds)/60.0 AS job_min
    FROM system.lakeflow.job_task_run_timeline
    LATERAL VIEW explode(compute) t AS c
    WHERE c.cluster_id='{cid}' AND period_start_time >= DATEADD(DAY, -{win}, CURRENT_DATE())
    """


def _mk(spark: Any, sql: str) -> dict[str, Any]:
    try:
        return _one(spark, sql)
    except Exception as e:  # pragma: no cover - depends on live schema/grants
        print(f"[compass] compute-lever query skipped: {str(e)[:160]}")
        return {}


def build_compute_recommendations(
    spark: Any, *, scan_id: str, workspace_id: str, workspace_name: str,
    window_days: int, compute_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    ws = workspace_id
    win = max(window_days, THRESHOLDS["engine"]["min_observation_days"])
    min_obs = THRESHOLDS["engine"]["min_observation_days"]
    recs: list[Recommendation] = []

    for row in compute_rows or []:
        kind = str(row.get("kind") or "")
        cid = str(row.get("compute_id") or "")
        name = str(row.get("name") or cid)
        cost = _num(row.get("cost_usd_30d"))
        dbus = _num(row.get("dbus_30d"))
        owner = str(row.get("owner") or "")
        if not cid or cost <= 0:
            continue

        if kind == "warehouse":
            serverless = bool(row.get("serverless"))
            cur = row.get("auto_stop_min")
            cur_i = int(cur) if cur not in (None, "") else 0
            if serverless:
                tcfg = THRESHOLDS["warehouse_autostop_serverless"]
                target = int(tcfg["min_autostop_minutes"])          # shorten toward 5
                # candidate: never-stops, or above the floor (room to shorten)
                if not (cur_i == 0 or cur_i > target):
                    continue
                cur_sec = (cur_i if cur_i > 0 else win * 24 * 60) * 60
                m = _mk(spark, _warehouse_gap_sql(ws, cid, cur_sec, target * 60, win))
                reclaim = _num(m.get("reclaim_min"))
                billed = _num(m.get("active_min")) + _num(m.get("warm_min"))
                obs = int(_num(m.get("observed_days")))
                extra = int(_num(m.get("extra_stops")))
                if obs < min_obs or reclaim <= 0 or billed <= 0:
                    continue
                # Usability guard: too many new stop/starts a day => not worth it.
                if obs > 0 and (extra / obs) > tcfg["churny_stops_per_day"]:
                    continue
                dpm = cost / billed
                p = warehouse_autostop_serverless_savings(reclaim, dpm, extra)
                if p.point < tcfg["min_savings_usd"]:
                    continue
                recs.append(Recommendation(
                    rule_id="FIN-103", rule_title="Serverless warehouse auto-stop too loose",
                    category="sql", resource_type="warehouse", resource_id=cid, resource_name=name,
                    resource_owner=owner,
                    why=(f"'{name}' billed {billed:,.0f} warm min vs {_num(m.get('active_min')):,.0f} active — "
                         f"shortening auto-stop from {cur_i or '∞'} to {target} min reclaims idle tail."),
                    how=f"Set the warehouse auto-stop to {target} minutes (serverless restarts in seconds).",
                    monthly_spend_usd=cost, savings_point_usd=p.point, savings_low_usd=p.low,
                    savings_high_usd=p.high, savings_status=p.status, confidence=p.confidence,
                    effort_band="trivial", priority=savings_priority(p.point), observed_days=obs,
                    evidence={"reclaim_min": round(reclaim, 1), "warm_min": round(_num(m.get("warm_min")), 1),
                              "active_min": round(_num(m.get("active_min")), 1), "extra_stops": extra,
                              "current_autostop_min": cur_i, "target_autostop_min": target,
                              "dollars_per_min": round(dpm, 4),
                              "source": "system.query.history (per-query warm gaps) + system.billing.usage",
                              "basis": "reclaimable warm minutes shortening auto-stop, no restart penalty (serverless)"},
                ))
            else:
                tcfg = THRESHOLDS["warehouse_autostop"]
                target = int(tcfg["target_autostop_minutes"])       # 10
                maxacc = int(tcfg["max_acceptable_minutes"])        # 30
                if not (cur_i == 0 or cur_i > maxacc):
                    continue
                cur_sec = (cur_i if cur_i > 0 else win * 24 * 60) * 60
                m = _mk(spark, _warehouse_gap_sql(ws, cid, cur_sec, target * 60, win))
                reclaim = _num(m.get("reclaim_min"))
                billed = _num(m.get("active_min")) + _num(m.get("warm_min"))
                obs = int(_num(m.get("observed_days")))
                if obs < min_obs or reclaim <= 0 or billed <= 0:
                    continue
                dpm = cost / billed
                p = warehouse_autostop_savings(reclaim, dpm)
                if p.point < tcfg["min_savings_usd"]:
                    continue
                recs.append(Recommendation(
                    rule_id="FIN-102", rule_title="Warehouse auto-stop too loose (classic/PRO)",
                    category="sql", resource_type="warehouse", resource_id=cid, resource_name=name,
                    resource_owner=owner,
                    why=(f"'{name}' keeps warm through long idle gaps ({_num(m.get('warm_min')):,.0f} warm min). "
                         f"A {target}-min auto-stop trades warm-pool cost against a billed restart."),
                    how=f"Lower the warehouse auto-stop from {cur_i or 'disabled'} to {target} minutes.",
                    monthly_spend_usd=cost, savings_point_usd=p.point, savings_low_usd=p.low,
                    savings_high_usd=p.high, savings_status=p.status, confidence=p.confidence,
                    effort_band="trivial", priority=savings_priority(p.point), observed_days=obs,
                    evidence={"reclaim_min": round(reclaim, 1), "warm_min": round(_num(m.get("warm_min")), 1),
                              "active_min": round(_num(m.get("active_min")), 1),
                              "current_autostop_min": cur_i, "target_autostop_min": target,
                              "dollars_per_min": round(dpm, 4),
                              "source": "system.query.history (per-query warm gaps) + system.billing.usage",
                              "basis": "reclaimable warm minutes shortening auto-stop; 3% residual margin"},
                ))

        elif kind == "cluster":
            cur = row.get("auto_stop_min")  # auto_termination_minutes on clusters
            cur_i = int(cur) if cur not in (None, "") else 0
            tcfg = THRESHOLDS["cluster_autotermination"]
            maxacc = int(tcfg["max_acceptable_minutes"])            # 60
            if not (cur_i == 0 or cur_i > maxacc):
                continue
            m = _mk(spark, _cluster_idle_sql(ws, cid, win, idle_cpu=10.0))
            total_min = _num(m.get("total_min"))
            idle_min = _num(m.get("idle_min"))
            obs = int(_num(m.get("observed_days")))
            if obs < min_obs or idle_min <= 0 or total_min <= 0:
                continue
            dpm = cost / total_min
            # One restart penalty per observed day (conservative gap count).
            p = cluster_autotermination_savings(idle_min, dpm, reclaimed_gaps=obs)
            if p.point < tcfg["min_savings_usd"]:
                continue
            recs.append(Recommendation(
                rule_id="FIN-101", rule_title="Cluster without (or with loose) auto-termination",
                category="compute", resource_type="cluster", resource_id=cid, resource_name=name,
                resource_owner=owner,
                why=(f"'{name}' ran idle {idle_min:,.0f} of {total_min:,.0f} measured minutes "
                     f"(avg CPU < 10%) with {'no' if not cur_i else f'a {cur_i}-min'} auto-termination."),
                how="Enable / tighten auto-termination (e.g. 15 min) so the cluster stops when idle.",
                monthly_spend_usd=cost, savings_point_usd=p.point, savings_low_usd=p.low,
                savings_high_usd=p.high, savings_status=p.status, confidence=p.confidence,
                effort_band="trivial", priority=savings_priority(p.point), observed_days=obs,
                evidence={"idle_min": round(idle_min, 1), "total_min": round(total_min, 1),
                          "current_autoterm_min": cur_i, "dollars_per_min": round(dpm, 4),
                          "source": "system.compute.node_timeline (per-minute CPU) + system.billing.usage",
                          "basis": "measured idle minutes reclaimed by auto-termination, net a daily restart"},
            ))

            # interactive_to_job: recurring jobs on this all-purpose cluster.
            jt = THRESHOLDS["interactive_to_job"]
            if cost >= jt["min_monthly_cost_usd"] and total_min > 0:
                j = _mk(spark, _job_share_sql(cid, win))
                nruns = int(_num(j.get("nruns")))
                job_min = _num(j.get("job_min"))
                if nruns >= 3 and job_min > 0:
                    job_share = min(1.0, job_min / total_min)
                    dedicated = job_share >= jt["dedicated_active_frac"]
                    # Fallback path (no measured SKU price gap available here): price the
                    # conservative all-purpose-vs-jobs fraction on the job-attributed spend.
                    attributed = cost * job_share
                    p = interactive_to_job_savings(
                        attributed_all_purpose_dbus=attributed, all_purpose_price=1.0,
                        jobs_compute_price=1.0 - jt["fallback_savings_fraction"],
                        resource_monthly_spend=cost, dedicated=dedicated,
                    )
                    if p.point >= 25.0:
                        recs.append(Recommendation(
                            rule_id="FIN-105", rule_title="Recurring jobs on an all-purpose cluster",
                            category="jobs", resource_type="cluster", resource_id=cid, resource_name=name,
                            resource_owner=owner,
                            why=(f"{nruns} job runs use all-purpose cluster '{name}' ({job_share*100:,.0f}% of its time). "
                                 f"All-purpose compute costs more than jobs compute for the same work."),
                            how="Move these jobs to jobs compute (job clusters) to pay the lower jobs-compute rate.",
                            monthly_spend_usd=cost, savings_point_usd=p.point, savings_low_usd=p.low,
                            savings_high_usd=p.high, savings_status=p.status, confidence=p.confidence,
                            effort_band="high", priority=savings_priority(p.point), observed_days=obs,
                            evidence={"job_runs": nruns, "job_share_pct": round(job_share * 100, 1),
                                      "dedicated": dedicated, "attributed_monthly_usd": round(attributed, 2),
                                      "source": "system.lakeflow.job_task_run_timeline + system.billing.usage",
                                      "basis": "conservative all-purpose-vs-jobs price fraction on job-attributed spend"},
                        ))

    out: list[dict[str, Any]] = []
    for r in recs:
        r.scan_id = scan_id
        r.workspace_id = workspace_id
        r.workspace_name = workspace_name
        out.append(r.to_row())
    return out
