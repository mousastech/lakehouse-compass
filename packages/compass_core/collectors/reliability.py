"""Reliability collector (spec §6.I).

Reads system.lakeflow.job_run_timeline to compute the job failure rate and emit
REL-001 when it is high.
"""

from __future__ import annotations

from ..models.capability import Availability
from ..models.finding import Finding, Severity
from .base import CollectorResult, SparkLike, cap, rows_as_dicts

FAILURE_RATE_THRESHOLD = 20.0


class ReliabilityCollector:
    domain = "reliability"

    def __init__(self, workspace_id: str, window_days: int = 14, scan_id: str = "live", workspace_name: str = ""):
        self.workspace_id = workspace_id
        self.workspace_name = workspace_name
        self.window_days = window_days
        self.scan_id = scan_id

    def collect(self, spark: SparkLike) -> CollectorResult:
        res = CollectorResult()
        ws, wd = self.workspace_id, self.window_days
        try:
            rows = rows_as_dicts(spark, f"""
                SELECT result_state AS state, COUNT(*) AS n
                FROM system.lakeflow.job_run_timeline
                WHERE workspace_id='{ws}' AND period_start_time>=DATEADD(DAY,-{wd},CURRENT_DATE())
                  AND result_state IS NOT NULL
                GROUP BY result_state """)
            res.capabilities.append(cap("lakeflow", "system.lakeflow.job_run_timeline", Availability.AVAILABLE))
        except Exception as e:  # pragma: no cover
            res.capabilities.append(cap("lakeflow", "system.lakeflow.job_run_timeline", Availability.NOT_AVAILABLE, str(e)[:200]))
            return res

        counts = {str(r["state"]): int(r["n"]) for r in rows}
        total = sum(counts.values())
        errors = counts.get("ERROR", 0) + counts.get("FAILED", 0) + counts.get("TIMED_OUT", 0)
        failure_rate = round(100.0 * errors / total, 1) if total else 0.0

        res.inventory["reliability_summary"] = [{
            "scan_id": self.scan_id, "workspace_id": ws,
            "total_runs": total, "errors": errors,
            "succeeded": counts.get("SUCCEEDED", 0), "failure_rate_pct": failure_rate,
        }]

        if total > 0 and failure_rate >= FAILURE_RATE_THRESHOLD:
            res.findings.append(Finding(
                id=f"{self.scan_id}-REL-001",
                rule_id="REL-001",
                domain="reliability",
                title="High job failure rate",
                severity=Severity.HIGH if failure_rate >= 40 else Severity.MEDIUM,
                resource=f"workspace: {self.workspace_id}",
                evidence={"failure_rate_pct": failure_rate, "errors": errors, "total_runs": total, "window_days": wd},
                remediation="Triage failing jobs; add retries and alerts; fix the most frequent failures first.",
                scan_id=self.scan_id,
                workspace_id=self.workspace_id,
                workspace_name=self.workspace_name,
            ))
        return res
