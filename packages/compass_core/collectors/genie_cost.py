"""Genie cost & consumption collector (Genie domain).

Reads system.billing.usage filtered to billing_origin_product = 'GENIE' for the
target workspace, joined to system.billing.list_prices for list cost. Produces
the Genie "Cost & Consumption" report that lives on the Genie screen:
  - genie_cost_summary: one row/scan/ws — billed cost, billed DBUs, free DBUs,
    active users over the window, plus by-surface / by-channel / by-sku / daily
    trend breakdowns encoded as JSON (the analytics plugin auto-parses them).
  - genie_cost_by_user: per-user free-vs-billed for the current month, with the
    GENIE_CODE free allowance (150 DBUs/month) and an over-allowance flag.

The usage_metadata.genie.surface / .channel fields distinguish GENIE_CODE from
GENIE_AGENTS at the billing layer — this is the source that lets Compass light
up the surface split that query.history alone could not (see DECISIONS).

Best-effort: billing is already probed by the FinOps collector, so this adds no
capability. If the GENIE usage source is unavailable, it writes no rows (never
fabricated). Emits GEN-COST-001 when GENIE_CODE users exceed the free allowance.
"""

from __future__ import annotations

import json

from ..models.finding import Finding, Severity
from .base import CollectorResult, SparkLike, rows_as_dicts

# GENIE_CODE ships a monthly free allowance (DBUs) per the public Genie pricing;
# other surfaces are free (no limit) through the current promo window.
_GENIE_CODE_FREE_ALLOWANCE_DBUS = 150

# List cost = effective list price (falls back to the default price tier).
_LIST_COST = "COALESCE(lp.pricing.effective_list.default, lp.pricing.default, 0)"

# LEFT JOIN so free-allowance rows (GENIE_FREE_USAGE has no list price) survive
# the join for the free-DBU aggregations; billed rows carry the price as usual.
_PRICE_JOIN = """
  LEFT JOIN system.billing.list_prices lp
    ON u.sku_name = lp.sku_name
   AND u.usage_end_time >= lp.price_start_time
   AND (lp.price_end_time IS NULL OR u.usage_end_time < lp.price_end_time)
"""


class GenieCostCollector:
    domain = "genie"

    def __init__(self, workspace_id: str, window_days: int = 30, scan_id: str = "live",
                 workspace_name: str = "", trend_lookback_days: int = 365):
        self.workspace_id = workspace_id
        self.workspace_name = workspace_name
        self.window_days = window_days
        self.scan_id = scan_id
        # Longer daily series for the evolutionary cost chart (UI rolls up to month
        # and filters by period client-side); independent of the KPI window.
        self.trend_lookback_days = trend_lookback_days

    def _tag(self, f: Finding) -> Finding:
        f.workspace_id = self.workspace_id
        f.workspace_name = self.workspace_name
        return f

    def collect(self, spark: SparkLike) -> CollectorResult:
        res = CollectorResult()
        ws = self.workspace_id
        win = self.window_days
        # billed = everything except the free SKU; the window scopes trend/summary.
        base = (
            f"u.billing_origin_product = 'GENIE' AND u.workspace_id = '{ws}' "
            f"AND u.usage_date >= DATEADD(DAY, -{win}, CURRENT_DATE())"
        )
        billed = f"{base} AND u.sku_name != 'GENIE_FREE_USAGE'"

        try:
            summary_rows = rows_as_dicts(
                spark,
                f"""
                SELECT
                  ROUND(SUM(CASE WHEN u.sku_name != 'GENIE_FREE_USAGE'
                       THEN u.usage_quantity * {_LIST_COST} ELSE 0 END), 2) AS billed_cost_usd,
                  ROUND(SUM(CASE WHEN u.sku_name != 'GENIE_FREE_USAGE'
                       THEN u.usage_quantity ELSE 0 END), 2) AS billed_dbus,
                  ROUND(SUM(CASE WHEN u.sku_name = 'GENIE_FREE_USAGE'
                       THEN u.usage_quantity ELSE 0 END), 2) AS free_dbus,
                  COUNT(DISTINCT u.identity_metadata.run_as) AS active_users
                FROM system.billing.usage u
                {_PRICE_JOIN}
                WHERE {base}
                """,
            )
        except Exception as e:  # pragma: no cover - depends on live grants
            print(f"[compass] genie_cost unavailable: {str(e)[:200]}")
            return res

        s0 = summary_rows[0] if summary_rows else {}
        # We always write a summary row when the billing query resolved (even an
        # all-zero one), so a real workspace with no Genie usage shows honest zeros
        # from live data rather than falling back to the demo fixture. Only a failed
        # billing query (handled in the except above) yields no row at all.

        def _safe(rows_fn):
            try:
                return rows_fn()
            except Exception as e:  # pragma: no cover - defensive per breakdown
                print(f"[compass] genie_cost breakdown skipped: {str(e)[:160]}")
                return []

        # Genie Code totals (the surface that actually bills) — free + billed DBUs,
        # cost and distinct users over the same window as the headline KPIs.
        code_rows = _safe(lambda: rows_as_dicts(
            spark,
            f"""
            SELECT
              ROUND(SUM(CASE WHEN u.sku_name = 'GENIE_FREE_USAGE' THEN u.usage_quantity ELSE 0 END), 2) AS code_free_dbus,
              ROUND(SUM(CASE WHEN u.sku_name != 'GENIE_FREE_USAGE' THEN u.usage_quantity ELSE 0 END), 2) AS code_billed_dbus,
              ROUND(SUM(u.usage_quantity), 2) AS code_total_dbus,
              ROUND(SUM(CASE WHEN u.sku_name != 'GENIE_FREE_USAGE'
                   THEN u.usage_quantity * {_LIST_COST} ELSE 0 END), 2) AS code_billed_cost_usd,
              COUNT(DISTINCT u.identity_metadata.run_as) AS code_users
            FROM system.billing.usage u
            {_PRICE_JOIN}
            WHERE {base} AND u.usage_metadata.genie.surface = 'GENIE_CODE'
            """,
        ))
        c0 = code_rows[0] if code_rows else {}

        # All Genie usage (free + billed) per surface, so free-only surfaces such
        # as GENIE_AGENTS still appear and the bar reflects total consumption.
        by_surface = _safe(lambda: rows_as_dicts(
            spark,
            f"""
            SELECT COALESCE(u.usage_metadata.genie.surface, 'UNKNOWN') AS surface,
                   ROUND(SUM(CASE WHEN u.sku_name != 'GENIE_FREE_USAGE'
                        THEN u.usage_quantity * {_LIST_COST} ELSE 0 END), 2) AS list_cost,
                   ROUND(SUM(CASE WHEN u.sku_name = 'GENIE_FREE_USAGE'
                        THEN u.usage_quantity ELSE 0 END), 2) AS free_dbus,
                   ROUND(SUM(CASE WHEN u.sku_name != 'GENIE_FREE_USAGE'
                        THEN u.usage_quantity ELSE 0 END), 2) AS billed_dbus,
                   ROUND(SUM(u.usage_quantity), 2) AS dbus
            FROM system.billing.usage u {_PRICE_JOIN}
            WHERE {base}
            GROUP BY 1 ORDER BY dbus DESC
            """,
        ))
        by_channel = _safe(lambda: rows_as_dicts(
            spark,
            f"""
            SELECT COALESCE(u.usage_metadata.genie.channel, 'UNKNOWN') AS channel,
                   ROUND(SUM(u.usage_quantity), 2) AS dbus
            FROM system.billing.usage u
            WHERE {billed}
            GROUP BY 1 ORDER BY dbus DESC
            """,
        ))
        by_sku = _safe(lambda: rows_as_dicts(
            spark,
            f"""
            SELECT u.sku_name AS sku, ROUND(SUM(u.usage_quantity), 2) AS dbus
            FROM system.billing.usage u
            WHERE {base}
            GROUP BY 1 ORDER BY dbus DESC
            """,
        ))
        trend = _safe(lambda: rows_as_dicts(
            spark,
            f"""
            SELECT CAST(u.usage_date AS STRING) AS usage_date,
                   ROUND(SUM(u.usage_quantity * {_LIST_COST}), 2) AS list_cost
            FROM system.billing.usage u {_PRICE_JOIN}
            WHERE {billed}
            GROUP BY 1 ORDER BY usage_date
            """,
        ))

        # Long daily series (default 365d) for the evolutionary cost chart — the UI
        # filters by period and rolls up to month client-side.
        trend_long = _safe(lambda: rows_as_dicts(
            spark,
            f"""
            SELECT CAST(u.usage_date AS STRING) AS usage_date,
                   ROUND(SUM(CASE WHEN u.sku_name != 'GENIE_FREE_USAGE'
                        THEN u.usage_quantity * {_LIST_COST} ELSE 0 END), 2) AS billed_cost_usd,
                   ROUND(SUM(CASE WHEN u.sku_name != 'GENIE_FREE_USAGE'
                        THEN u.usage_quantity ELSE 0 END), 2) AS billed_dbus,
                   ROUND(SUM(CASE WHEN u.sku_name = 'GENIE_FREE_USAGE'
                        THEN u.usage_quantity ELSE 0 END), 2) AS free_dbus
            FROM system.billing.usage u {_PRICE_JOIN}
            WHERE u.billing_origin_product = 'GENIE' AND u.workspace_id = '{ws}'
              AND u.usage_date >= DATEADD(DAY, -{self.trend_lookback_days}, CURRENT_DATE())
            GROUP BY 1 ORDER BY usage_date
            """,
        ))
        res.inventory["genie_cost_trend"] = [
            {"scan_id": self.scan_id, "workspace_id": ws, "workspace_name": self.workspace_name,
             "usage_date": r.get("usage_date"),
             "billed_cost_usd": float(r.get("billed_cost_usd") or 0.0),
             "billed_dbus": float(r.get("billed_dbus") or 0.0),
             "free_dbus": float(r.get("free_dbus") or 0.0)}
            for r in trend_long
        ]

        res.inventory["genie_cost_summary"] = [{
            "scan_id": self.scan_id,
            "workspace_id": ws,
            "workspace_name": self.workspace_name,
            "window_days": int(win),
            "billed_cost_usd": float(s0.get("billed_cost_usd") or 0.0),
            "billed_dbus": float(s0.get("billed_dbus") or 0.0),
            "free_dbus": float(s0.get("free_dbus") or 0.0),
            "active_users": int(s0.get("active_users") or 0),
            # Genie Code focus (the billing surface).
            "code_free_dbus": float(c0.get("code_free_dbus") or 0.0),
            "code_billed_dbus": float(c0.get("code_billed_dbus") or 0.0),
            "code_total_dbus": float(c0.get("code_total_dbus") or 0.0),
            "code_billed_cost_usd": float(c0.get("code_billed_cost_usd") or 0.0),
            "code_users": int(c0.get("code_users") or 0),
            "by_surface_json": json.dumps(by_surface, default=str),
            "by_channel_json": json.dumps(by_channel, default=str),
            "by_sku_json": json.dumps(by_sku, default=str),
            "trend_json": json.dumps(trend, default=str),
        }]

        # Per-user free-vs-billed for the CURRENT MONTH (to compare against the
        # monthly free allowance), mirroring the Genie Cost Monitor dashboard.
        per_user = _safe(lambda: rows_as_dicts(
            spark,
            f"""
            SELECT
              u.identity_metadata.run_as AS run_as_user,
              COALESCE(u.usage_metadata.genie.surface, 'UNKNOWN') AS genie_surface,
              ROUND(SUM(CASE WHEN u.sku_name = 'GENIE_FREE_USAGE' THEN u.usage_quantity ELSE 0 END), 2) AS free_dbus,
              ROUND(SUM(CASE WHEN u.sku_name != 'GENIE_FREE_USAGE' THEN u.usage_quantity ELSE 0 END), 2) AS paid_dbus,
              ROUND(SUM(CASE WHEN u.sku_name != 'GENIE_FREE_USAGE'
                   THEN u.usage_quantity * {_LIST_COST} ELSE 0 END), 2) AS billed_cost_usd
            FROM system.billing.usage u
            {_PRICE_JOIN}
            WHERE u.billing_origin_product = 'GENIE' AND u.workspace_id = '{ws}'
              AND u.usage_date >= DATE_TRUNC('MONTH', CURRENT_DATE)
            GROUP BY 1, 2
            HAVING free_dbus > 0 OR paid_dbus > 0
            ORDER BY billed_cost_usd DESC, paid_dbus DESC
            """,
        ))
        user_rows = []
        over_allowance_users = []
        for r in per_user:
            surface = r.get("genie_surface") or "UNKNOWN"
            is_code = surface == "GENIE_CODE"
            allowance = _GENIE_CODE_FREE_ALLOWANCE_DBUS if is_code else None
            paid = float(r.get("paid_dbus") or 0.0)
            # A GENIE_CODE user with paid DBUs has exhausted the free allowance.
            over = bool(is_code and paid > 0)
            user_rows.append({
                "scan_id": self.scan_id,
                "workspace_id": ws,
                "workspace_name": self.workspace_name,
                "run_as_user": r.get("run_as_user") or "(unattributed)",
                "genie_surface": surface,
                "free_dbus": float(r.get("free_dbus") or 0.0),
                "paid_dbus": paid,
                "billed_cost_usd": float(r.get("billed_cost_usd") or 0.0),
                "free_allowance_limit": allowance,
                "over_allowance": over,
            })
            if over:
                over_allowance_users.append(r.get("run_as_user") or "(unattributed)")
        res.inventory["genie_cost_by_user"] = user_rows

        # GEN-COST-001 — GENIE_CODE users past the monthly free allowance are billed.
        if over_allowance_users:
            billed_cost = float(s0.get("billed_cost_usd") or 0.0)
            res.findings.append(Finding(
                id=f"{self.scan_id}-{ws}-GEN-COST-001",
                rule_id="GEN-COST-001",
                domain="genie",
                title="Genie Code users past the free allowance are billing",
                severity=Severity.MEDIUM,
                resource=f"{len(over_allowance_users)} user(s) over the {_GENIE_CODE_FREE_ALLOWANCE_DBUS} DBU/month allowance",
                evidence={
                    "over_allowance_users": over_allowance_users[:15],
                    "free_allowance_dbus": _GENIE_CODE_FREE_ALLOWANCE_DBUS,
                    "billed_cost_usd_window": round(billed_cost, 2),
                    "window_days": int(win),
                },
                remediation=(
                    "Review Genie Code consumers past the 150 DBU/month free allowance; "
                    "attribute spend to named users and set expectations on paid usage."
                ),
                scan_id=self.scan_id,
            ))

        res.findings = [self._tag(f) for f in res.findings]
        return res
