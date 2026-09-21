"""Performance collector (spec §6.G).

Reads system.query.history to summarize query latency per identity (for the
Utilization Scatter) and emits PERF-010 when p90 latency is high.
"""

from __future__ import annotations

from ..models.capability import Availability
from ..models.finding import Finding, Severity
from .base import CollectorResult, SparkLike, cap, rows_as_dicts

P90_THRESHOLD_MS = 30000


class PerformanceCollector:
    domain = "performance"

    def __init__(self, workspace_id: str, window_days: int = 7, scan_id: str = "live", workspace_name: str = ""):
        self.workspace_id = workspace_id
        self.workspace_name = workspace_name
        self.window_days = window_days
        self.scan_id = scan_id

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
            res.findings.append(Finding(
                id=f"{self.scan_id}-PERF-010",
                rule_id="PERF-010",
                domain="performance",
                title="High query latency (p90 above threshold)",
                severity=Severity.MEDIUM,
                resource=f"workspace: {self.workspace_id}",
                evidence={"p90_ms": p90, "slow_queries": slow, "total_queries": total, "threshold_ms": P90_THRESHOLD_MS, "window_days": self.window_days},
                remediation="Right-size warehouses; cluster hot tables; review the slowest statements.",
                scan_id=self.scan_id,
                workspace_id=self.workspace_id,
                workspace_name=self.workspace_name,
            ))
        return res
