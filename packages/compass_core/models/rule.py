"""Rule model (spec §5). Rules are declared in YAML under rules/definitions/.
v3 adds frameworks, maintenance metadata and an agent_explainer template."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from .finding import Severity


class WafPillar(str, Enum):
    """The seven pillars of the Databricks Well-Architected Framework.
    A rule may map to more than one pillar (see Rule.waf_pillars)."""

    OPERATIONAL_EXCELLENCE = "operational_excellence"
    SECURITY = "security"
    RELIABILITY = "reliability"
    PERFORMANCE_EFFICIENCY = "performance_efficiency"
    COST_OPTIMIZATION = "cost_optimization"
    DATA_AI_GOVERNANCE = "data_ai_governance"
    INTEROPERABILITY_USABILITY = "interoperability_usability"


class RuleLevel(str, Enum):
    REQUIRED = "REQUIRED"
    RECOMMENDED = "RECOMMENDED"
    CONTEXT_DEPENDENT = "CONTEXT_DEPENDENT"


class Recurrence(str, Enum):
    NONE = "none"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ON_EXPIRY = "on-expiry"


@dataclass
class Maintenance:
    recurrence: Recurrence = Recurrence.NONE
    lead_days: int = 0


@dataclass
class Rule:
    id: str
    domain: str
    title: str
    description: str
    severity: Severity
    level: RuleLevel
    # capability ids this rule needs; if none usable -> finding is NOT_MEASURABLE
    requires: list[str] = field(default_factory=list)
    frameworks: list[str] = field(default_factory=list)
    # Databricks Well-Architected Framework pillars this rule contributes to.
    waf_pillars: list[WafPillar] = field(default_factory=list)
    maintenance: Maintenance | None = None
    agent_explainer: str = ""
    remediation: str = ""
    docs: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Rule":
        maint = None
        if d.get("maintenance"):
            m = d["maintenance"]
            maint = Maintenance(
                recurrence=Recurrence(m.get("recurrence", "none")),
                lead_days=int(m.get("lead_days", 0)),
            )
        return cls(
            id=d["id"],
            domain=d["domain"],
            title=d["title"],
            description=d.get("description", ""),
            severity=Severity(d["severity"].lower()),
            level=RuleLevel(d.get("level", "RECOMMENDED")),
            requires=list(d.get("requires", [])),
            frameworks=list(d.get("frameworks", [])),
            waf_pillars=[WafPillar(p) for p in d.get("waf_pillars", [])],
            maintenance=maint,
            agent_explainer=d.get("agent_explainer", ""),
            remediation=d.get("remediation", ""),
            docs=list(d.get("docs", [])),
        )
