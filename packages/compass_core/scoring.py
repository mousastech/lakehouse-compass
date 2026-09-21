"""Weighted scoring (spec §6, §10).

Overall score is the weight-weighted average of domain scores. A domain score
starts at 100 and is reduced by open findings, penalized by severity. Coverage
is the fraction of applicable rules that were actually evaluable given current
capabilities (rules resolving to NOT_MEASURABLE do not count against the score
but do lower coverage).
"""

from __future__ import annotations

from .models.finding import Finding, Severity, Status
from .models.rule import WafPillar
from .models.score import DomainScore, Score, WafPillarScore

# Domain weights (spec §6).
DOMAIN_WEIGHTS: dict[str, int] = {
    "security": 25,
    "finops": 20,
    "ai_estate": 12,
    "governance": 12,
    "performance": 10,
    "usage": 8,
    "genie": 6,
    "lakebase": 4,
    "reliability": 3,
}

# Per-finding penalty by severity (points off the domain's 100).
SEVERITY_PENALTY: dict[Severity, float] = {
    Severity.CRITICAL: 18.0,
    Severity.HIGH: 10.0,
    Severity.MEDIUM: 4.0,
    Severity.LOW: 1.5,
    Severity.INFO: 0.0,
}


def score_domain(domain: str, findings: list[Finding]) -> DomainScore:
    """Score a single domain from its open findings."""
    weight = DOMAIN_WEIGHTS.get(domain, 0)
    open_findings = [f for f in findings if f.status == Status.OPEN]
    penalty = sum(SEVERITY_PENALTY[f.severity] for f in open_findings)
    score = max(0.0, 100.0 - penalty)
    critical = sum(1 for f in open_findings if f.severity == Severity.CRITICAL)
    return DomainScore(
        domain=domain,
        weight=weight,
        score=round(score, 1),
        findings=len(open_findings),
        critical_findings=critical,
    )


def attach_waf_pillars(findings: list[Finding], registry: object | None = None) -> list[Finding]:
    """Fill each finding's waf_pillars from its rule (single source: the YAML
    rule definitions). Idempotent: findings that already carry pillars are left
    untouched. Mutates and returns the same list for convenience."""
    reg = registry
    if reg is None:
        from .rules import RuleRegistry

        reg = RuleRegistry()
    for f in findings:
        if f.waf_pillars:
            continue
        rule = reg.get(f.rule_id)  # type: ignore[attr-defined]
        if rule is not None:
            f.waf_pillars = [p.value for p in rule.waf_pillars]
    return findings


def score_waf_pillars(
    findings: list[Finding], rule_counts: dict[str, int] | None = None
) -> list[WafPillarScore]:
    """Score each WAF pillar from the open findings mapped to it. A finding that
    maps to multiple pillars penalizes each of them (a real-world control gap
    weakens every pillar it touches). Uses the same severity penalties as
    domains so the numbers read consistently across the app."""
    rule_counts = rule_counts or {}
    open_findings = [f for f in findings if f.status == Status.OPEN]
    scores: list[WafPillarScore] = []
    for pillar in WafPillar:
        pf = [f for f in open_findings if pillar.value in f.waf_pillars]
        penalty = sum(SEVERITY_PENALTY[f.severity] for f in pf)
        scores.append(
            WafPillarScore(
                pillar=pillar.value,
                score=round(max(0.0, 100.0 - penalty), 1),
                findings=len(pf),
                critical_findings=sum(1 for f in pf if f.severity == Severity.CRITICAL),
                rules=rule_counts.get(pillar.value, 0),
            )
        )
    return scores


def overall_score(
    findings: list[Finding],
    coverage_pct: float = 100.0,
    scan_id: str | None = None,
    rule_counts: dict[str, int] | None = None,
) -> Score:
    """Compute the overall weighted score across all domains, plus per-WAF-pillar
    sub-scores. `rule_counts` (pillar -> number of mapped rules) is optional and
    only annotates coverage breadth; pass RuleRegistry-derived counts to populate."""
    domain_scores: list[DomainScore] = []
    for domain in DOMAIN_WEIGHTS:
        domain_findings = [f for f in findings if f.domain == domain]
        domain_scores.append(score_domain(domain, domain_findings))

    total_weight = sum(ds.weight for ds in domain_scores) or 1
    weighted = sum(ds.score * ds.weight for ds in domain_scores)
    overall = round(weighted / total_weight, 1)

    return Score(
        overall=overall,
        coverage_pct=round(coverage_pct, 1),
        domains=domain_scores,
        waf_pillars=score_waf_pillars(findings, rule_counts),
        scan_id=scan_id,
    )
