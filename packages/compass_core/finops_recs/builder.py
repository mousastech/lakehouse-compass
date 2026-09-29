"""Build FinOps recommendations from inventory the scan already collects.

This is a **pure** function over rows the diagnostic collectors produced this
scan (``cost_detail`` from the FinOps collector, ``endpoint_usage_summary`` +
``cost_detail`` for serving endpoints). Keeping it pure means every dollar and
every tier is covered by a unit test with known input rows — no live Spark
needed, so the whole recommendation pipeline is verifiable offline before it
ever deploys.

Levers implemented here (measurable from existing inventory, no new SQL):
* ``FIN-104 idle_serving_endpoints`` — zero-traffic endpoint's own billed cost
  (bookable / high; ``endpoint_usage`` is a per-request log).
* ``FIN-027 untagged_spend`` — resources whose spend cannot be attributed to an
  owner/team (advisory $0; ranks on the unattributable spend).

Levers that need new measurement SQL (per-query gap reconstruction for
warehouse/cluster auto-stop; job-runtime attribution for interactive_to_job)
are the next increment — see docs/FINOPS_RECOMMENDATIONS.md. This module's
contract (``build_recommendations`` returning ``list[Recommendation]``) does not
change when they land; they append rows.
"""

from __future__ import annotations

import json
from typing import Any

from .model import Recommendation
from .savings import (
    THRESHOLDS,
    idle_serving_endpoint_savings,
    savings_priority,
    untagged_spend_priority,
)

# Tag keys (lowercased) that satisfy each required ownership dimension. A resource
# missing an owner identity AND all of these is unattributable. Extend per org.
_OWNER_TAG_KEYS = {
    "owner", "ownedby", "owner_email", "ownername", "contact",
    "team", "department", "dept", "group", "businessunit", "business_unit",
    "cost_center", "costcenter", "cc", "billingcode",
}


def _to_monthly(cost_usd: float, window_days: int) -> float:
    if window_days <= 0:
        return float(cost_usd)
    return float(cost_usd) * (30.0 / window_days)


def _has_owner_tag(tags_json: str | None) -> bool:
    if not tags_json:
        return False
    try:
        tags = json.loads(tags_json)
    except (ValueError, TypeError):
        return False
    if not isinstance(tags, dict):
        return False
    return any(str(k).lower() in _OWNER_TAG_KEYS for k in tags)


def _idle_serving_endpoints(
    endpoint_usage: list[dict[str, Any]],
    cost_detail: list[dict[str, Any]],
    window_days: int,
) -> list[Recommendation]:
    # Billed cost per serving endpoint, from cost_detail (the resource's own spend).
    cost_by_ep: dict[str, float] = {}
    for r in cost_detail:
        if (r.get("resource_type") or "") == "serving_endpoint":
            name = str(r.get("resource_name") or "")
            cost_by_ep[name] = cost_by_ep.get(name, 0.0) + float(r.get("cost_usd") or 0.0)

    t = THRESHOLDS["idle_serving_endpoints"]
    recs: list[Recommendation] = []
    for u in endpoint_usage:
        name = str(u.get("endpoint_name") or "")
        requests = int(u.get("requests_30d") or 0)
        if requests > t["max_requests"]:
            continue  # genuinely in use → not idle
        monthly = _to_monthly(cost_by_ep.get(name, 0.0), window_days)
        if monthly < t["min_savings_usd"]:
            continue  # a zero-traffic endpoint that barely bills isn't worth it
        p = idle_serving_endpoint_savings(monthly)
        recs.append(
            Recommendation(
                rule_id="FIN-104",
                rule_title="Idle serving endpoint (zero traffic, still billing)",
                category="serving",
                resource_type="serving_endpoint",
                resource_id=name,
                resource_name=name,
                why=(
                    f"This endpoint served 0 requests in the last {window_days} days "
                    f"but billed ~${monthly:,.0f}/mo — it is always-on with no traffic."
                ),
                how="Scale to zero (min_concurrency=0) or delete the endpoint if unused.",
                monthly_spend_usd=monthly,
                savings_point_usd=p.point,
                savings_low_usd=p.low,
                savings_high_usd=p.high,
                savings_status=p.status,
                confidence=p.confidence,
                effort_band="low",
                priority=savings_priority(p.point),
                observed_days=window_days,
                evidence={
                    "requests_30d": requests,
                    "monthly_billed_usd": round(monthly, 2),
                    "source": "system.serving.endpoint_usage + system.billing.usage",
                    "basis": "zero-traffic endpoint's own measured billed cost",
                },
            )
        )
    return recs


def _untagged_spend(
    cost_detail: list[dict[str, Any]], window_days: int
) -> list[Recommendation]:
    # Aggregate spend per resource that has neither an owner identity nor an owner tag.
    agg: dict[tuple[str, str], dict[str, Any]] = {}
    for r in cost_detail:
        owner = (r.get("owner") or "").strip()
        if owner or _has_owner_tag(r.get("tags_json")):
            continue  # attributable → skip
        rtype = str(r.get("resource_type") or "other")
        rname = str(r.get("resource_name") or "—")
        key = (rtype, rname)
        cur = agg.setdefault(key, {"cost": 0.0, "dbus": 0.0})
        cur["cost"] += float(r.get("cost_usd") or 0.0)
        cur["dbus"] += float(r.get("dbus") or 0.0)

    t = THRESHOLDS["untagged_spend"]
    recs: list[Recommendation] = []
    for (rtype, rname), v in agg.items():
        monthly = _to_monthly(v["cost"], window_days)
        if monthly < t["min_monthly_cost_usd"]:
            continue
        recs.append(
            Recommendation(
                rule_id="FIN-027",
                rule_title="Spend without owner attribution (chargeback gap)",
                category="governance",
                resource_type=rtype,
                resource_id=rname,
                resource_name=rname,
                why=(
                    f"~${monthly:,.0f}/mo on this {rtype} has no run-as owner and no "
                    f"ownership tag, so it cannot be charged back or held accountable."
                ),
                how="Set a run-as owner and apply an owner/team/cost_center tag policy.",
                monthly_spend_usd=monthly,
                savings_point_usd=0.0,  # tagging changes attribution, not the bill
                savings_status="advisory",
                confidence="high",
                effort_band="low",
                priority=untagged_spend_priority(monthly),
                observed_days=window_days,
                evidence={
                    "unattributable_monthly_usd": round(monthly, 2),
                    "dbus": round(v["dbus"], 2),
                    "source": "system.billing.usage (identity_metadata + custom_tags)",
                    "basis": "no run-as owner and no owner/team/cost_center tag",
                },
            )
        )
    return recs


def build_recommendations(
    *,
    scan_id: str,
    workspace_id: str,
    workspace_name: str,
    window_days: int,
    cost_detail: list[dict[str, Any]] | None = None,
    endpoint_usage: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Return ``finops_recommendations`` rows (flat dicts) for one workspace.

    Each lever is best-effort: a missing input list yields no rows for that lever
    and never raises, mirroring the collectors' defensive contract.
    """
    cost_detail = cost_detail or []
    endpoint_usage = endpoint_usage or []

    recs: list[Recommendation] = []
    recs += _idle_serving_endpoints(endpoint_usage, cost_detail, window_days)
    recs += _untagged_spend(cost_detail, window_days)

    rows: list[dict[str, Any]] = []
    for r in recs:
        r.scan_id = scan_id
        r.workspace_id = workspace_id
        r.workspace_name = workspace_name
        rows.append(r.to_row())
    # Rank by Next Best Action so the app can render the list as-is.
    rows.sort(key=lambda x: x["nba_score"], reverse=True)
    return rows
