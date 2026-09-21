"""FinOps collector (spec §6.B).

Reads system.billing.usage joined to system.billing.list_prices for the target
workspace over a trailing window. Produces:
  - a cost_summary inventory (product / sku / identity / cost_usd / dbus) for the
    FinOps Cost Flow / Treemap visuals,
  - findings: FIN-027 (spend without attribution) and FIN-030 (Genie spend).
"""

from __future__ import annotations

from ..models.capability import Availability
from ..models.finding import Finding, Severity
from .base import CollectorResult, SparkLike, cap, rows_as_dicts

# AI / inference-oriented products (best-effort classification for the AI-spend card).
_AI_PRODUCTS = ("MODEL_SERVING", "LAKEHOUSE_REAL_TIME", "FOUNDATION_MODEL", "VECTOR_SEARCH")

_PRICE_JOIN = """
  LEFT JOIN system.billing.list_prices lp
    ON u.sku_name = lp.sku_name
   AND u.usage_unit = lp.usage_unit
   AND u.usage_end_time >= lp.price_start_time
   AND (u.usage_end_time < lp.price_end_time OR lp.price_end_time IS NULL)
"""


class FinOpsCollector:
    domain = "finops"

    def __init__(self, workspace_id: str, window_days: int = 30, scan_id: str = "live", workspace_name: str = ""):
        self.workspace_id = workspace_id
        self.workspace_name = workspace_name
        self.window_days = window_days
        self.scan_id = scan_id

    def _tag(self, f: Finding) -> Finding:
        f.workspace_id = self.workspace_id
        f.workspace_name = self.workspace_name
        return f

    def collect(self, spark: SparkLike) -> CollectorResult:
        res = CollectorResult()
        where = (
            f"u.workspace_id = '{self.workspace_id}' "
            f"AND u.usage_date >= DATEADD(DAY, -{self.window_days}, CURRENT_DATE())"
        )
        try:
            summary = rows_as_dicts(
                spark,
                f"""
                SELECT
                  u.billing_origin_product AS product,
                  u.sku_name AS sku,
                  COALESCE(u.identity_metadata.run_as, '(unattributed)') AS identity,
                  ROUND(SUM(u.usage_quantity * COALESCE(lp.pricing.default, 0)), 2) AS cost_usd,
                  ROUND(SUM(u.usage_quantity), 2) AS dbus
                FROM system.billing.usage u
                {_PRICE_JOIN}
                WHERE {where}
                GROUP BY 1, 2, 3
                HAVING cost_usd > 0
                ORDER BY cost_usd DESC
                """,
            )
            res.capabilities.append(cap("billing", "system.billing.usage", Availability.AVAILABLE))
        except Exception as e:  # pragma: no cover - depends on live grants
            res.capabilities.append(
                cap("billing", "system.billing.usage", Availability.NOT_AVAILABLE, str(e)[:300])
            )
            return res

        for row in summary:
            row["scan_id"] = self.scan_id
            row["workspace_id"] = self.workspace_id
            row["workspace_name"] = self.workspace_name
            row["is_ai"] = any(p in (row.get("product") or "") for p in _AI_PRODUCTS)
        res.inventory["cost_summary"] = summary

        # cost_detail — per (product, sku, identity, resource) breakdown for the
        # FinOps drill-down: names come from usage_metadata (app/endpoint/job/…).
        # Best-effort: a metastore missing a usage_metadata field would fail the
        # whole query, so on error we skip the detail (summary still stands).
        try:
            detail = rows_as_dicts(
                spark,
                f"""
                SELECT
                  u.billing_origin_product AS product,
                  u.sku_name AS sku,
                  COALESCE(u.identity_metadata.run_as, '(unattributed)') AS identity,
                  CASE
                    WHEN u.usage_metadata.app_name IS NOT NULL OR u.usage_metadata.app_id IS NOT NULL THEN 'app'
                    WHEN u.usage_metadata.endpoint_name IS NOT NULL OR u.usage_metadata.endpoint_id IS NOT NULL THEN 'serving_endpoint'
                    WHEN u.usage_metadata.warehouse_id IS NOT NULL THEN 'warehouse'
                    WHEN u.usage_metadata.dlt_pipeline_id IS NOT NULL THEN 'pipeline'
                    WHEN u.usage_metadata.job_id IS NOT NULL THEN 'job'
                    WHEN u.usage_metadata.cluster_id IS NOT NULL THEN 'cluster'
                    WHEN u.usage_metadata.notebook_id IS NOT NULL THEN 'notebook'
                    ELSE 'other'
                  END AS resource_type,
                  COALESCE(
                    u.usage_metadata.app_name, u.usage_metadata.endpoint_name, u.usage_metadata.job_name,
                    u.usage_metadata.warehouse_id, u.usage_metadata.dlt_pipeline_id, u.usage_metadata.cluster_id,
                    u.usage_metadata.job_id, u.usage_metadata.app_id, u.usage_metadata.notebook_id, '—'
                  ) AS resource_name,
                  COALESCE(u.identity_metadata.owned_by, u.identity_metadata.created_by, '') AS owner,
                  to_json(u.custom_tags) AS tags_json,
                  ROUND(SUM(u.usage_quantity * COALESCE(lp.pricing.default, 0)), 2) AS cost_usd,
                  ROUND(SUM(u.usage_quantity), 2) AS dbus,
                  COUNT(*) AS records
                FROM system.billing.usage u
                {_PRICE_JOIN}
                WHERE {where}
                GROUP BY 1, 2, 3, 4, 5, 6, 7
                HAVING cost_usd > 0
                ORDER BY cost_usd DESC
                LIMIT 800
                """,
            )
            for row in detail:
                row["scan_id"] = self.scan_id
                row["workspace_id"] = self.workspace_id
                row["workspace_name"] = self.workspace_name
            res.inventory["cost_detail"] = detail
        except Exception as e:  # pragma: no cover - depends on live schema
            print(f"[compass] cost_detail unavailable: {str(e)[:200]}")

        total = sum(float(r["cost_usd"]) for r in summary) or 0.0
        unattributed = sum(
            float(r["cost_usd"]) for r in summary if r["identity"] == "(unattributed)"
        )
        unattributed_pct = round(100.0 * unattributed / total, 1) if total else 0.0

        # FIN-027 — spend without attribution above threshold.
        if total > 0 and unattributed_pct >= 40.0:
            res.findings.append(
                Finding(
                    id=f"{self.scan_id}-FIN-027",
                    rule_id="FIN-027",
                    domain="finops",
                    title="Most spend has no run-as identity / cost attribution",
                    severity=Severity.HIGH,
                    resource=f"workspace: {self.workspace_id}",
                    evidence={
                        "unattributed_usd": round(unattributed, 2),
                        "total_usd": round(total, 2),
                        "unattributed_pct": unattributed_pct,
                        "window_days": self.window_days,
                    },
                    remediation="Adopt a cost-tag policy and set run-as identities so spend is attributable.",
                    framework_controls=["DBX-SBP:MON-2"],
                    scan_id=self.scan_id,
                )
            )

        # FIN-030 — Genie spend present (attribution check).
        genie_usd = sum(
            float(r["cost_usd"]) for r in summary if "GENIE" in (r.get("product") or "")
        )
        if genie_usd > 0:
            res.findings.append(
                Finding(
                    id=f"{self.scan_id}-FIN-030",
                    rule_id="FIN-030",
                    domain="finops",
                    title="Genie consumption present — verify per-user attribution",
                    severity=Severity.MEDIUM,
                    resource=f"workspace: {self.workspace_id}",
                    evidence={"genie_usd": round(genie_usd, 2), "window_days": self.window_days},
                    remediation="Attribute Genie usage to named users; review SP-driven Genie traffic.",
                    scan_id=self.scan_id,
                )
            )

        res.findings = [self._tag(f) for f in res.findings]
        return res
