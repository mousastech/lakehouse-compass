"""The recommendation contract, the effort/priority weights and the NBA formula.

One recommendation is a single dataclass. It is written to the Delta table
``finops_recommendations`` and read back by the app, so its ``to_row`` shape is
the schema contract — change it additively (append keys; never rename).

Two axes are deliberately independent (see docs/FINOPS_RECOMMENDATIONS.md):

* **confidence** — how directly platform data backs the estimate
  (``high`` / ``medium`` / ``low``). It is a property of the *method*, not of
  the dollar size, and is NOT a numeric error bar.
* **savings band** — the plausible dollar bracket ``[low, point, high]`` around
  the point estimate. A narrow band does not imply high confidence.

``savings_status`` decides how the dollar rolls up:

* ``bookable`` — realised by the action itself on a directly-measured cost; its
  ``low`` is the only thing banked into the headline lower bound.
* ``estimated`` — shown and rankable, but contributes 0 to the booked total.
* ``advisory`` — no dollars booked (governance/operational levers).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Any

# Effort band -> numeric weight. NBA = savings / effort_score, so tuning these
# rebalances the savings-vs-effort tradeoff without touching rule code.
EFFORT_WEIGHTS: dict[str, int] = {"trivial": 1, "low": 2, "medium": 3, "high": 5}

# Priority multiplier applied to the NBA score.
PRIORITY_MULT: dict[str, float] = {"HIGH": 1.25, "MEDIUM": 1.0, "LOW": 0.8}

CONFIDENCE_TIERS = ("high", "medium", "low")
SAVINGS_STATUSES = ("bookable", "estimated", "advisory")


def nba_score(savings_point_usd: float, effort_band: str, priority: str) -> float:
    """Next-Best-Action rank = savings / effort_score x priority multiplier."""
    effort = EFFORT_WEIGHTS.get(effort_band, 3)
    mult = PRIORITY_MULT.get(priority, 1.0)
    return round((savings_point_usd / effort) * mult, 2)


@dataclass
class Recommendation:
    rule_id: str
    rule_title: str
    category: str  # compute | sql | jobs | serving | pipelines | governance
    resource_type: str  # cluster | warehouse | job | serving_endpoint | pipeline | workspace
    resource_id: str
    resource_name: str
    why: str
    how: str
    monthly_spend_usd: float
    savings_point_usd: float
    savings_status: str  # bookable | estimated | advisory
    confidence: str  # high | medium | low
    effort_band: str  # trivial | low | medium | high
    priority: str  # HIGH | MEDIUM | LOW
    resource_owner: str = ""
    observed_days: int = 0
    savings_low_usd: float | None = None
    savings_high_usd: float | None = None
    evidence: dict[str, Any] = field(default_factory=dict)
    # populated by the collector, denormalized for scoping/joins
    scan_id: str = ""
    workspace_id: str = ""
    workspace_name: str = ""

    def __post_init__(self) -> None:
        # A rule that doesn't widen its band collapses to a point (low==point==high).
        if self.savings_low_usd is None:
            self.savings_low_usd = self.savings_point_usd
        if self.savings_high_usd is None:
            self.savings_high_usd = self.savings_point_usd
        if self.confidence not in CONFIDENCE_TIERS:
            raise ValueError(f"bad confidence tier: {self.confidence!r}")
        if self.savings_status not in SAVINGS_STATUSES:
            raise ValueError(f"bad savings_status: {self.savings_status!r}")
        if self.effort_band not in EFFORT_WEIGHTS:
            raise ValueError(f"bad effort_band: {self.effort_band!r}")

    @property
    def effort_score(self) -> int:
        return EFFORT_WEIGHTS[self.effort_band]

    @property
    def nba(self) -> float:
        # Advisory findings book nothing but still rank on the spend at risk.
        return nba_score(self.savings_point_usd, self.effort_band, self.priority)

    def recommendation_id(self) -> str:
        key = f"{self.rule_id}|{self.workspace_id}|{self.resource_id}|{self.scan_id}"
        return hashlib.sha256(key.encode()).hexdigest()[:32]

    def to_row(self) -> dict[str, Any]:
        """Flat, JSON-serializable row matching the Delta schema."""
        return {
            "scan_id": self.scan_id,
            "workspace_id": self.workspace_id,
            "workspace_name": self.workspace_name,
            "recommendation_id": self.recommendation_id(),
            "rule_id": self.rule_id,
            "rule_title": self.rule_title,
            "category": self.category,
            "resource_type": self.resource_type,
            "resource_id": str(self.resource_id),
            "resource_name": str(self.resource_name),
            "resource_owner": self.resource_owner or "",
            "why": self.why,
            "how": self.how,
            "monthly_spend_usd": round(float(self.monthly_spend_usd), 2),
            "savings_point_usd": round(float(self.savings_point_usd), 2),
            "savings_low_usd": round(float(self.savings_low_usd or 0.0), 2),
            "savings_high_usd": round(float(self.savings_high_usd or 0.0), 2),
            "savings_status": self.savings_status,
            "confidence": self.confidence,
            "effort_band": self.effort_band,
            "effort_score": self.effort_score,
            "priority": self.priority,
            "nba_score": self.nba,
            "observed_days": int(self.observed_days),
            "evidence_json": json.dumps(self.evidence, default=str),
        }

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)
