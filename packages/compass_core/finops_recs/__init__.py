"""Clean-room FinOps recommendation engine for Lakehouse Compass.

This package turns cost signals from public System Tables into *actionable,
dollarized* recommendations: each finding carries a savings band
(``low <= point <= high``), a qualitative confidence tier, a savings status
(bookable / estimated / advisory) and a Next-Best-Action rank
(``savings / effort x priority``).

It is a first-class sibling of the diagnostic ``collectors`` package: the
scan job runs the collector, writes ``finops_recommendations`` to Delta, and
the app renders a ranked list on the FinOps screen that plugs into the same
autonomous loop (digest -> advisor triage -> 1-click Draft change) as every
other Compass finding.

Methodology (which lever, which savings math, which confidence tier) is derived
from Databricks' public cost-optimization guidance and the Well-Architected
Cost pillar, applied to public System Tables only. No proprietary code.
"""

from .model import (
    CONFIDENCE_TIERS,
    EFFORT_WEIGHTS,
    PRIORITY_MULT,
    SAVINGS_STATUSES,
    Recommendation,
    nba_score,
)

__all__ = [
    "Recommendation",
    "nba_score",
    "EFFORT_WEIGHTS",
    "PRIORITY_MULT",
    "CONFIDENCE_TIERS",
    "SAVINGS_STATUSES",
]
