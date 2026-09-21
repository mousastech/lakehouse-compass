"""Score models (spec §6, §10)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class DomainScore:
    domain: str
    weight: int
    score: float  # 0-100
    findings: int = 0
    critical_findings: int = 0


@dataclass
class WafPillarScore:
    """Score for one Well-Architected Framework pillar, derived from the open
    findings whose rules map to that pillar (see Rule.waf_pillars)."""

    pillar: str
    score: float  # 0-100
    findings: int = 0
    critical_findings: int = 0
    rules: int = 0  # number of rules mapped to this pillar (coverage breadth)


@dataclass
class Score:
    overall: float
    coverage_pct: float
    domains: list[DomainScore] = field(default_factory=list)
    # v3 sub-scores
    semantic_readiness: float | None = None
    compliance_coverage: float | None = None
    waf_pillars: list[WafPillarScore] = field(default_factory=list)
    scan_id: str | None = None
