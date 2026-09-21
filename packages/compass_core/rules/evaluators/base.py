"""Evaluator base (spec §5).

An evaluator takes a Rule + an EvalContext (collected data + capabilities) and
returns zero or more Findings. If a rule's required capabilities are not usable
it yields a single NOT_MEASURABLE finding so coverage reflects reality.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from ...models.capability import Capability
from ...models.finding import Finding, Status
from ...models.rule import Rule


@dataclass
class EvalContext:
    scan_id: str
    capabilities: dict[str, Capability] = field(default_factory=dict)
    data: dict[str, Any] = field(default_factory=dict)  # collector outputs keyed by source

    def can_evaluate(self, rule: Rule) -> bool:
        if not rule.requires:
            return True
        return all(
            cap_id in self.capabilities and self.capabilities[cap_id].is_usable
            for cap_id in rule.requires
        )


EvalResult = list[Finding]


class Evaluator(Protocol):
    rule_id: str

    def evaluate(self, rule: Rule, ctx: EvalContext) -> EvalResult: ...


def not_measurable(rule: Rule, ctx: EvalContext) -> Finding:
    """Emit a NOT_MEASURABLE finding when required capabilities are missing."""
    missing = [c for c in rule.requires if c not in ctx.capabilities or not ctx.capabilities[c].is_usable]
    return Finding(
        id=f"{rule.id}-nm",
        rule_id=rule.id,
        domain=rule.domain,
        title=f"{rule.title} (not measurable)",
        severity=rule.severity,
        resource="—",
        status=Status.NOT_MEASURABLE,
        evidence={"missing_capabilities": missing},
        framework_controls=rule.frameworks,
        waf_pillars=[p.value for p in rule.waf_pillars],
        scan_id=ctx.scan_id,
    )
