"""Governance collector (spec §6.D).

Uses system.information_schema to measure metadata quality for a governed catalog
and compute the Semantic Readiness sub-score:
  - GOV-025: high share of tables without descriptions (metadata debt).
The Semantic Readiness metric (comment coverage) is returned for the score.
"""

from __future__ import annotations

from ..models.capability import Availability
from ..models.finding import Finding, Severity
from .base import CollectorResult, SparkLike, cap, rows_as_dicts


class GovernanceCollector:
    domain = "governance"

    def __init__(self, catalog: str, workspace_id: str, scan_id: str = "live", workspace_name: str = ""):
        self.catalog = catalog
        self.workspace_id = workspace_id
        self.workspace_name = workspace_name
        self.scan_id = scan_id

    def collect(self, spark: SparkLike) -> CollectorResult:
        res = CollectorResult()
        try:
            rows = rows_as_dicts(
                spark,
                f"""
                SELECT COUNT(*) AS total, COUNT(comment) AS with_comment
                FROM system.information_schema.tables
                WHERE table_catalog = '{self.catalog}' AND table_schema <> 'information_schema'
                """,
            )
            res.capabilities.append(cap("data_classification", "system.information_schema", Availability.AVAILABLE))
        except Exception as e:  # pragma: no cover
            res.capabilities.append(cap("data_classification", "system.information_schema", Availability.NOT_AVAILABLE, str(e)[:200]))
            return res

        total = int(rows[0]["total"] or 0) if rows else 0
        with_comment = int(rows[0]["with_comment"] or 0) if rows else 0
        undocumented = total - with_comment
        coverage = round(100.0 * with_comment / total, 1) if total else 0.0

        res.inventory["governance_metrics"] = [
            {"scan_id": self.scan_id, "workspace_id": self.workspace_id, "metric": "comment_coverage_pct", "value": coverage, "detail": self.catalog},
            {"scan_id": self.scan_id, "workspace_id": self.workspace_id, "metric": "tables_total", "value": float(total), "detail": self.catalog},
            {"scan_id": self.scan_id, "workspace_id": self.workspace_id, "metric": "tables_undocumented", "value": float(undocumented), "detail": self.catalog},
        ]
        res.semantic_readiness = coverage

        if total > 0 and coverage < 80.0:
            res.findings.append(Finding(
                id=f"{self.scan_id}-GOV-025",
                rule_id="GOV-025",
                domain="governance",
                title="Tables lacking descriptions (metadata debt)",
                severity=Severity.LOW if coverage >= 50 else Severity.MEDIUM,
                resource=f"catalog: {self.catalog}",
                evidence={"total_tables": total, "undocumented": undocumented, "comment_coverage_pct": coverage},
                remediation="Add descriptions to the most-queried tables; enforce coverage for gold assets.",
                framework_controls=["DBX-SBP:GOV-2"],
                scan_id=self.scan_id,
                workspace_id=self.workspace_id,
                workspace_name=self.workspace_name,
            ))

        return res
