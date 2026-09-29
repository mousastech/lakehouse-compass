"""Savings math for each cost lever — pure, unit-testable pricing functions.

The division of labour mirrors the diagnostic collectors: **SQL finds candidates
and measures the physical quantity cheaply; Python prices it here.** Each function
takes already-measured inputs (reclaimable minutes, attributed DBUs, billed cost,
a $/unit rate) and returns a ``Priced`` result — the point estimate, a
conservative band, the confidence tier and the savings status. Keeping the money
out of SQL means every dollar figure is covered by a test with a known input.

The estimate must never exceed the resource's own avoidable spend; callers cap it.
Pricing is conservative by construction (see each function's docstring).
"""

from __future__ import annotations

from dataclasses import dataclass

# Clean-room, runtime-tunable thresholds. Defaults follow Databricks' public
# cost-optimization guidance (Well-Architected Cost pillar) and are deliberately
# conservative; a deployment can override them.
THRESHOLDS: dict[str, dict[str, float]] = {
    "engine": {
        "min_observation_days": 5,   # too-new-to-judge guard (distinct active days)
        "recency_days": 7,           # a resource with no recent spend has stopped
    },
    "cluster_autotermination": {
        "max_acceptable_minutes": 60,  # missing/0/>this => candidate
        "restart_penalty_min": 5,      # billed minutes charged per reclaimed idle gap
        "min_savings_usd": 10,
    },
    "warehouse_autostop": {
        "max_acceptable_minutes": 30,
        "target_autostop_minutes": 10,
        "residual_frac": 0.03,         # 3% residual margin on gap arithmetic
        "min_savings_usd": 10,
    },
    "warehouse_autostop_serverless": {
        "max_acceptable_minutes": 10,  # serverless default is 10
        "min_autostop_minutes": 5,     # never recommend below the UI floor
        "startup_penalty_min": 1,      # serverless starts in seconds; next query still waits
        "min_savings_usd": 5,
    },
    "idle_serving_endpoints": {
        "max_requests": 0,             # zero-traffic => full-cost, high-confidence tier
        "min_days_billed": 7,
        "min_savings_usd": 25,
    },
    "interactive_to_job": {
        "min_monthly_cost_usd": 200,
        "dedicated_active_frac": 0.9,  # >= this share dedicated => the gap is realizable
        "fallback_savings_fraction": 0.30,  # only if the real SKU price gap is missing
    },
    "untagged_spend": {
        "min_monthly_cost_usd": 50,
        "high_priority_monthly_usd": 1000,
        "medium_priority_monthly_usd": 250,
    },
}


@dataclass
class Priced:
    point: float
    low: float
    high: float
    confidence: str  # high | medium | low
    status: str      # bookable | estimated | advisory


def _band(point: float, low: float, high: float) -> tuple[float, float, float]:
    """Clamp a band so low <= point <= high and nothing is negative."""
    point = max(0.0, point)
    low = max(0.0, min(low, point))
    high = max(point, high)
    return round(point, 2), round(low, 2), round(high, 2)


def cluster_autotermination_savings(
    reclaimable_idle_minutes: float, dollars_per_minute: float, reclaimed_gaps: int
) -> Priced:
    """Idle classic-cluster minutes reclaimed by adding/tightening auto-termination.

    Idle gaps longer than the target timeout are reclaimable; each reclaimed gap
    pays a restart penalty (the cluster must spin back up on the next use). The
    idle hours and rate are directly measured, so this is **bookable / high** —
    the only risk is future usage differing from the measured window.
    """
    penalty = reclaimed_gaps * THRESHOLDS["cluster_autotermination"]["restart_penalty_min"]
    net_minutes = max(0.0, reclaimable_idle_minutes - penalty)
    point = net_minutes * dollars_per_minute
    # Band: the measurement is direct; allow a modest downside for usage drift.
    return Priced(*_band(point, low=point * 0.85, high=point), confidence="high", status="bookable")


def warehouse_autostop_savings(
    reclaimable_warm_minutes: float, dollars_per_minute: float
) -> Priced:
    """Classic/PRO warehouse warm-idle minutes reclaimed by a shorter auto-stop.

    A shorter auto-stop on a classic/PRO warehouse trades idle warm-pool cost
    against a real (billed) cold-start restart. The reclaimable minutes come from
    per-query gap reconstruction; a 3% residual margin is netted. Because the
    warm/restart trade-off rests on a modelled counterfactual auto-stop value,
    this is **estimated / medium**, not booked.
    """
    residual = THRESHOLDS["warehouse_autostop"]["residual_frac"]
    point = reclaimable_warm_minutes * dollars_per_minute * (1 - residual)
    return Priced(*_band(point, low=point * 0.6, high=point), confidence="medium", status="estimated")


def warehouse_autostop_serverless_savings(
    reclaimable_idle_minutes: float, dollars_per_minute: float, extra_restarts: int
) -> Priced:
    """Serverless warehouse idle-tail minutes reclaimed by a shorter auto-stop.

    Serverless starts in seconds and bills per-second, so shortening auto-stop
    incurs no meaningful cold-start cost — only a 1-minute startup penalty per
    extra restart. Per-query timestamps + billing make this **bookable / high**.
    """
    penalty = extra_restarts * THRESHOLDS["warehouse_autostop_serverless"]["startup_penalty_min"]
    net = max(0.0, reclaimable_idle_minutes - penalty)
    point = net * dollars_per_minute
    return Priced(*_band(point, low=point * 0.9, high=point), confidence="high", status="bookable")


def idle_serving_endpoint_savings(monthly_billed_usd: float) -> Priced:
    """A zero-traffic serving endpoint's own billed cost.

    ``system.serving.endpoint_usage`` is a per-request log, so "nobody calls this"
    is COUNTED, not inferred. Removing / scaling-to-zero the endpoint reclaims its
    full measured cost — **bookable / high**.
    """
    point = monthly_billed_usd
    return Priced(*_band(point, low=point, high=point), confidence="high", status="bookable")


def interactive_to_job_savings(
    attributed_all_purpose_dbus: float,
    all_purpose_price: float,
    jobs_compute_price: float,
    resource_monthly_spend: float,
    dedicated: bool,
) -> Priced:
    """Recurring jobs on an all-purpose cluster: move them to jobs compute.

    The saving is the **measured** SKU price gap on the DBUs attributed to the
    jobs by their share of cluster runtime: ``attributed_dbus x (all_purpose -
    jobs_compute)``. On a **dedicated** cluster (jobs occupy ~all its uptime),
    removing the jobs eliminates it and the gap is realizable → **bookable /
    high**. On a **shared** cluster the box may keep running for interactive use,
    so the lower bound is $0 and it stays **estimated / medium**.
    """
    gap = max(0.0, all_purpose_price - jobs_compute_price)
    point = min(attributed_all_purpose_dbus * gap, resource_monthly_spend)
    if dedicated:
        return Priced(*_band(point, low=point, high=point), confidence="high", status="bookable")
    return Priced(*_band(point, low=0.0, high=point), confidence="medium", status="estimated")


def untagged_spend_priority(monthly_cost_usd: float) -> str:
    """Chargeback gap: $0 saving by design; priority tracks unattributable spend."""
    t = THRESHOLDS["untagged_spend"]
    if monthly_cost_usd >= t["high_priority_monthly_usd"]:
        return "HIGH"
    if monthly_cost_usd >= t["medium_priority_monthly_usd"]:
        return "MEDIUM"
    return "LOW"


def savings_priority(savings_point_usd: float, high_at: float = 500.0, medium_at: float = 100.0) -> str:
    """Priority band on the dollar size of a saving (effort being comparable)."""
    if savings_point_usd >= high_at:
        return "HIGH"
    if savings_point_usd >= medium_at:
        return "MEDIUM"
    return "LOW"
