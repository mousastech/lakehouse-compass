"""Performance collector (spec §6.G).

Reads system.query.history to summarize query latency per identity (for the
Utilization Scatter) and emits PERF-010 when p90 latency is high.

Also builds a **compute inventory** — SQL warehouses (via the SDK REST callable,
local workspace only) and interactive/all-purpose clusters (system.compute.clusters)
— enriched with 30-day cost (system.billing.usage) and utilization
(system.query.history), and emits compute health findings PERF-020..023. Every
compute source is best-effort: a failing source degrades that column, never the
whole collector, and empty sources yield no rows (never fabricated).
"""

from __future__ import annotations

from typing import Callable, Optional

from ..models.capability import Availability
from ..models.finding import Finding, Severity
from .base import CollectorResult, SparkLike, cap, rows_as_dicts

P90_THRESHOLD_MS = 30000
# Interactive clusters below this Databricks Runtime major version are flagged as
# outdated (14.3 LTS is the recent long-term-support baseline).
_MIN_DBR_MAJOR = 14

_PRICE_JOIN = """
  LEFT JOIN system.billing.list_prices lp
    ON u.sku_name = lp.sku_name
   AND u.usage_end_time >= lp.price_start_time
   AND (lp.price_end_time IS NULL OR u.usage_end_time < lp.price_end_time)
"""


def _dbr_major(v: str) -> Optional[int]:
    """Best-effort major version from a DBR string like '14.3.x-scala2.12'."""
    if not v:
        return None
    head = str(v).strip().split(".")[0]
    return int(head) if head.isdigit() else None


class PerformanceCollector:
    domain = "performance"

    def __init__(self, workspace_id: str, window_days: int = 7, scan_id: str = "live",
                 workspace_name: str = "", rest: Optional[Callable[..., dict]] = None,
                 inventory_window_days: int = 30):
        self.workspace_id = workspace_id
        self.workspace_name = workspace_name
        self.window_days = window_days
        self.scan_id = scan_id
        self.rest = rest
        self.inventory_window_days = inventory_window_days

    def _tag(self, f: Finding) -> Finding:
        f.workspace_id = self.workspace_id
        f.workspace_name = self.workspace_name
        return f

    def collect(self, spark: SparkLike) -> CollectorResult:
        res = CollectorResult()
        where = (
            f"workspace_id='{self.workspace_id}' AND start_time>=DATEADD(DAY,-{self.window_days},CURRENT_DATE()) "
            f"AND total_duration_ms IS NOT NULL"
        )
        try:
            rows = rows_as_dicts(
                spark,
                f"""
                SELECT executed_by AS entity,
                       COUNT(*) AS queries,
                       ROUND(AVG(total_duration_ms),0) AS avg_ms,
                       ROUND(MAX(total_duration_ms),0) AS max_ms
                FROM system.query.history
                WHERE {where}
                GROUP BY executed_by ORDER BY queries DESC LIMIT 25
                """,
            )
            p90rows = rows_as_dicts(
                spark,
                f"SELECT ROUND(PERCENTILE(total_duration_ms,0.9),0) AS p90, COUNT(*) AS total, "
                f"SUM(CASE WHEN total_duration_ms>{P90_THRESHOLD_MS} THEN 1 ELSE 0 END) AS slow "
                f"FROM system.query.history WHERE {where}",
            )
            res.capabilities.append(cap("query", "system.query.history", Availability.AVAILABLE))
        except Exception as e:  # pragma: no cover
            res.capabilities.append(cap("query", "system.query.history", Availability.NOT_AVAILABLE, str(e)[:200]))
            return res

        for r in rows:
            r["scan_id"] = self.scan_id
            r["workspace_id"] = self.workspace_id
            r["entity"] = r.get("entity") or "(unknown)"
            r["queries"] = int(r.get("queries") or 0)
            r["avg_ms"] = float(r.get("avg_ms") or 0)
            r["max_ms"] = float(r.get("max_ms") or 0)
        res.inventory["perf_summary"] = rows

        p90 = float(p90rows[0]["p90"]) if p90rows and p90rows[0]["p90"] is not None else 0.0
        total = int(p90rows[0]["total"] or 0) if p90rows else 0
        slow = int(p90rows[0]["slow"] or 0) if p90rows else 0
        if total > 0 and p90 > P90_THRESHOLD_MS:
            res.findings.append(self._tag(Finding(
                id=f"{self.scan_id}-PERF-010",
                rule_id="PERF-010",
                domain="performance",
                title="High query latency (p90 above threshold)",
                severity=Severity.MEDIUM,
                resource=f"workspace: {self.workspace_id}",
                evidence={"p90_ms": p90, "slow_queries": slow, "total_queries": total, "threshold_ms": P90_THRESHOLD_MS, "window_days": self.window_days},
                remediation="Right-size warehouses; cluster hot tables; review the slowest statements.",
                scan_id=self.scan_id,
            )))

        # ---- Compute inventory (warehouses + interactive clusters) ----
        self._compute_inventory(spark, res)
        return res

    def _compute_inventory(self, spark: SparkLike, res: CollectorResult) -> None:
        ws = self.workspace_id
        win = self.inventory_window_days

        def _safe(fn):
            try:
                return fn()
            except Exception as e:  # pragma: no cover - defensive per source
                print(f"[compass] compute inventory source skipped: {str(e)[:160]}")
                return []

        # Cost by compute (billing.usage, 30d) keyed on warehouse_id / cluster_id.
        cost = {}
        for r in _safe(lambda: rows_as_dicts(
            spark,
            f"""
            SELECT COALESCE(u.usage_metadata.warehouse_id, u.usage_metadata.cluster_id) AS compute_id,
                   ROUND(SUM(u.usage_quantity * COALESCE(lp.pricing.effective_list.default, lp.pricing.default, 0)), 2) AS cost_usd,
                   ROUND(SUM(u.usage_quantity), 2) AS dbus
            FROM system.billing.usage u
            {_PRICE_JOIN}
            WHERE u.workspace_id = '{ws}'
              AND u.usage_date >= DATEADD(DAY, -{win}, CURRENT_DATE())
              AND (u.usage_metadata.warehouse_id IS NOT NULL OR u.usage_metadata.cluster_id IS NOT NULL)
            GROUP BY 1
            """,
        )):
            if r.get("compute_id"):
                cost[r["compute_id"]] = {"cost_usd": float(r.get("cost_usd") or 0.0), "dbus": float(r.get("dbus") or 0.0)}

        # Utilization by warehouse (query.history, 30d).
        util = {}
        for r in _safe(lambda: rows_as_dicts(
            spark,
            f"""
            SELECT compute.warehouse_id AS compute_id, COUNT(*) AS queries,
                   ROUND(AVG(total_duration_ms), 0) AS avg_ms,
                   ROUND(PERCENTILE(total_duration_ms, 0.9), 0) AS p90_ms
            FROM system.query.history
            WHERE workspace_id = '{ws}' AND start_time >= DATEADD(DAY, -{win}, CURRENT_DATE())
              AND compute.warehouse_id IS NOT NULL AND total_duration_ms IS NOT NULL
            GROUP BY 1
            """,
        )):
            if r.get("compute_id"):
                util[r["compute_id"]] = {"queries": int(r.get("queries") or 0), "avg_ms": float(r.get("avg_ms") or 0.0), "p90_ms": float(r.get("p90_ms") or 0.0)}

        inv: list[dict] = []

        # SQL warehouses (SDK REST, local workspace only).
        no_autostop: list[str] = []
        classic: list[str] = []
        if self.rest is not None:
            try:
                listing = self.rest("GET", "/api/2.0/sql/warehouses") or {}
                for w in (listing.get("warehouses") or []):
                    cid = str(w.get("id") or "")
                    serverless = bool(w.get("enable_serverless_compute"))
                    auto_stop = w.get("auto_stop_mins")
                    auto_stop = int(auto_stop) if auto_stop is not None else None
                    c = cost.get(cid, {})
                    u = util.get(cid, {})
                    inv.append({
                        "kind": "warehouse", "compute_id": cid, "name": str(w.get("name") or cid),
                        "size": str(w.get("cluster_size") or ""), "serverless": serverless,
                        "auto_stop_min": auto_stop,
                        "min_clusters": int(w.get("min_num_clusters") or 0),
                        "max_clusters": int(w.get("max_num_clusters") or 0),
                        "dbr_version": "", "state": str(w.get("state") or ""), "owner": "",
                        "queries_30d": int(u.get("queries") or 0),
                        "avg_ms": float(u.get("avg_ms") or 0.0), "p90_ms": float(u.get("p90_ms") or 0.0),
                        "dbus_30d": float(c.get("dbus") or 0.0), "cost_usd_30d": float(c.get("cost_usd") or 0.0),
                    })
                    if not auto_stop:
                        no_autostop.append(str(w.get("name") or cid))
                    if not serverless:
                        classic.append(str(w.get("name") or cid))
            except Exception as e:  # pragma: no cover - depends on API access
                print(f"[compass] warehouses API unavailable: {str(e)[:160]}")

        # Interactive / all-purpose clusters (system.compute.clusters, latest active row).
        no_autoterm: list[str] = []
        old_dbr: list[str] = []
        for r in _safe(lambda: rows_as_dicts(
            spark,
            f"""
            SELECT cluster_id, cluster_name, auto_termination_minutes, dbr_version, worker_count,
                   min_autoscale_workers, max_autoscale_workers, owned_by
            FROM (
              SELECT *, ROW_NUMBER() OVER (PARTITION BY cluster_id ORDER BY change_time DESC) AS _rn
              FROM system.compute.clusters
              WHERE workspace_id = '{ws}' AND cluster_source IN ('UI', 'API')
            ) WHERE _rn = 1 AND delete_time IS NULL
            """,
        )):
            cid = str(r.get("cluster_id") or "")
            name = str(r.get("cluster_name") or cid)
            autoterm = r.get("auto_termination_minutes")
            autoterm = int(autoterm) if autoterm is not None else None
            dbr = str(r.get("dbr_version") or "")
            c = cost.get(cid, {})
            inv.append({
                "kind": "cluster", "compute_id": cid, "name": name, "size": "", "serverless": None,
                "auto_stop_min": autoterm,
                "min_clusters": int(r.get("min_autoscale_workers") or 0),
                "max_clusters": int(r.get("max_autoscale_workers") or r.get("worker_count") or 0),
                "dbr_version": dbr, "state": "", "owner": str(r.get("owned_by") or ""),
                "queries_30d": 0, "avg_ms": 0.0, "p90_ms": 0.0,
                "dbus_30d": float(c.get("dbus") or 0.0), "cost_usd_30d": float(c.get("cost_usd") or 0.0),
            })
            if not autoterm:
                no_autoterm.append(name)
            major = _dbr_major(dbr)
            if major is not None and major < _MIN_DBR_MAJOR:
                old_dbr.append(f"{name} (DBR {dbr})")

        if not inv:
            return  # no compute discoverable — never fabricate
        for row in inv:
            row["scan_id"] = self.scan_id
            row["workspace_id"] = self.workspace_id
            row["workspace_name"] = self.workspace_name
        res.inventory["compute_inventory"] = inv

        def _finding(rid: str, title: str, sev: Severity, resources: list[str], remediation: str, key: str) -> None:
            if not resources:
                return
            res.findings.append(self._tag(Finding(
                id=f"{self.scan_id}-{self.workspace_id}-{rid}",
                rule_id=rid, domain="performance", title=title, severity=sev,
                resource=f"{len(resources)} of {len(inv)} compute",
                evidence={key: resources[:20], "count": len(resources)},
                remediation=remediation, scan_id=self.scan_id,
            )))

        _finding("PERF-020", "SQL warehouses without auto-stop", Severity.MEDIUM, no_autostop,
                 "Set an auto-stop (e.g. 10 min) on each SQL warehouse so idle compute stops billing.", "warehouses")
        _finding("PERF-021", "Classic SQL warehouses (serverless opportunity)", Severity.LOW, classic,
                 "Consider Serverless SQL warehouses to eliminate idle/startup cost and cold starts.", "warehouses")
        _finding("PERF-022", "Interactive clusters without auto-termination", Severity.MEDIUM, no_autoterm,
                 "Enable auto-termination on interactive clusters so idle clusters stop billing.", "clusters")
        _finding("PERF-023", f"Interactive clusters on outdated DBR (< {_MIN_DBR_MAJOR}.x)", Severity.LOW, old_dbr,
                 f"Upgrade interactive clusters to a current LTS runtime ({_MIN_DBR_MAJOR}.3 LTS or newer).", "clusters")
