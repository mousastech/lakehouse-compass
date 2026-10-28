"""Governance collector (spec §6.D).

Uses system.information_schema to measure metadata coverage across the user
catalogs this scan can read and compute the Semantic Readiness sub-score:
  - GOV-025: high share of tables without descriptions (metadata debt).
The Semantic Readiness metric (table comment coverage) is returned for the score.
Description *quality* and tag-based monitoring live in the metadata collector.

Also probes Data Classification (`system.data_classification.results`) so the
`data_classification` capability reflects the real feature, not comment
coverage. The probe selects a constant — never the `samples` column, which holds
real data values.
"""

from __future__ import annotations

from ..models.capability import Availability
from ..models.finding import Finding, Severity
from .base import CollectorResult, SparkLike, cap, rows_as_dicts
from .metadata import internal_filter


class GovernanceCollector:
    domain = "governance"

    def __init__(self, catalog: str, workspace_id: str, scan_id: str = "live", workspace_name: str = ""):
        # `catalog` is the fallback scope when the metastore-wide view isn't readable.
        self.catalog = catalog
        self.workspace_id = workspace_id
        self.workspace_name = workspace_name
        self.scan_id = scan_id

    def _coverage(self, spark: SparkLike) -> tuple[list[dict], str]:
        base = "SELECT COUNT(*) AS total, COUNT(NULLIF(trim(comment), '')) AS with_comment FROM {src} WHERE {where}"
        try:
            rows = rows_as_dicts(spark, base.format(
                src="system.information_schema.tables",
                where="table_schema <> 'information_schema'" + internal_filter("table_catalog")))
            return rows, "all user catalogs"
        except Exception:
            rows = rows_as_dicts(spark, base.format(
                src=f"`{self.catalog}`.information_schema.tables",
                where="table_schema <> 'information_schema'"))
            return rows, self.catalog

    def collect(self, spark: SparkLike) -> CollectorResult:
        res = CollectorResult()
        try:
            spark.sql("SELECT 1 FROM system.data_classification.results LIMIT 1").collect()
            res.capabilities.append(cap("data_classification", "system.data_classification.results",
                                        Availability.AVAILABLE))
        except Exception as e:
            res.capabilities.append(cap("data_classification", "system.data_classification.results",
                                        Availability.NOT_AVAILABLE,
                                        "Needs SELECT on system.data_classification.results (account admin by "
                                        f"default). {str(e)[:160]}"))
        try:
            rows, scope = self._coverage(spark)
        except Exception as e:  # pragma: no cover
            res.capabilities.append(cap("tags", "system.information_schema", Availability.NOT_AVAILABLE, str(e)[:200]))
            return res

        total = int(rows[0]["total"] or 0) if rows else 0
        with_comment = int(rows[0]["with_comment"] or 0) if rows else 0
        undocumented = total - with_comment
        coverage = round(100.0 * with_comment / total, 1) if total else 0.0

        res.inventory["governance_metrics"] = [
            {"scan_id": self.scan_id, "workspace_id": self.workspace_id, "metric": "comment_coverage_pct", "value": coverage, "detail": scope},
            {"scan_id": self.scan_id, "workspace_id": self.workspace_id, "metric": "tables_total", "value": float(total), "detail": scope},
            {"scan_id": self.scan_id, "workspace_id": self.workspace_id, "metric": "tables_undocumented", "value": float(undocumented), "detail": scope},
        ]
        res.semantic_readiness = coverage

        if total > 0 and coverage < 80.0:
            res.findings.append(Finding(
                id=f"{self.scan_id}-GOV-025",
                rule_id="GOV-025",
                domain="governance",
                title="Tables lacking descriptions (metadata debt)",
                severity=Severity.LOW if coverage >= 50 else Severity.MEDIUM,
                resource=f"scope: {scope}",
                evidence={"total_tables": total, "undocumented": undocumented, "comment_coverage_pct": coverage},
                remediation="Add descriptions to the most-queried tables; enforce coverage for gold assets.",
                framework_controls=["DBX-SBP:GOV-2"],
                scan_id=self.scan_id,
                workspace_id=self.workspace_id,
                workspace_name=self.workspace_name,
            ))

        return res
