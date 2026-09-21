"""Well-Architected control catalogue (WAF Phase 2).

A structured, control-catalogue-driven assessment of the seven Databricks
Well-Architected Framework pillars — the methodology of
``databricks-solutions/databricks-waf`` re-implemented in Compass's style and
re-derived from the public WAF docs (their source is proprietary; we copy the
approach and cite the public pages, not their code).

Each control declares:
  - id / pillar / principle / title
  - provenance:    waf-docs | security-guide | extension   (where it comes from)
  - measurability: system_table | rest_api | attestation | derived
  - severity:      critical | high | medium | low | info
  - criteria:      the pass condition, in plain text
  - rule:          the Compass rule id that evaluates it (or None → unmeasured
                   until a rule or attestation is wired — never faked)
  - remediation / doc_url

A control is *measured* when it links to a Compass rule that exists and whose
required capabilities are usable for the scan; otherwise it is *unmeasured*
(honest coverage, mirroring Compass's NOT_AVAILABLE convention). The per-pillar
score then carries a low/high band = measurement uncertainty.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import yaml

_CATALOGUE_DIR = os.path.join(os.path.dirname(__file__), "catalogue")

PROVENANCE = {"waf-docs", "security-guide", "extension"}
MEASURABILITY = {"system_table", "rest_api", "attestation", "derived"}
LEVEL_LABELS = ["Absent", "Initial", "Developing", "Established", "Optimized"]


@dataclass
class WafControl:
    id: str
    pillar: str
    principle: str
    title: str
    provenance: str
    measurability: str
    severity: str
    criteria: str
    remediation: str
    doc_url: str
    rule: str | None = None


@dataclass
class ControlOutcome:
    control: WafControl
    status: str  # pass | gap | unmeasured | attestation
    measured: bool


@dataclass
class PillarAssessment:
    pillar: str
    total: int
    measured: int
    passed: int
    gaps: int
    score: float          # health of MEASURED controls (passed/measured), 0-100
    low: float            # worst case: unmeasured assumed failing
    high: float           # best case: unmeasured assumed passing
    confidence: str       # high | medium | low
    outcomes: list[ControlOutcome] = field(default_factory=list)


def load_controls(directory: str | None = None) -> list[WafControl]:
    """Load every control from the per-pillar YAML files under ``catalogue/``."""
    directory = directory or _CATALOGUE_DIR
    out: list[WafControl] = []
    for name in sorted(os.listdir(directory)):
        if not name.endswith((".yaml", ".yml")):
            continue
        with open(os.path.join(directory, name), "r", encoding="utf-8") as fh:
            doc = yaml.safe_load(fh) or {}
        pillar = doc.get("pillar")
        for c in doc.get("controls", []) or []:
            rem = c.get("remediation") or {}
            out.append(WafControl(
                id=c["id"],
                pillar=c.get("pillar", pillar),
                principle=c.get("principle", ""),
                title=c["title"],
                provenance=c.get("provenance", "waf-docs"),
                measurability=c.get("measurability", "attestation"),
                severity=str(c.get("severity", "medium")).lower(),
                criteria=c.get("criteria", ""),
                remediation=(rem.get("summary") if isinstance(rem, dict) else str(rem)) or "",
                doc_url=(rem.get("doc_url") if isinstance(rem, dict) else "") or c.get("doc_url", ""),
                rule=c.get("rule"),
            ))
    return out


def _confidence(measured: int, total: int) -> str:
    frac = (measured / total) if total else 0.0
    if frac >= 0.75:
        return "high"
    if frac >= 0.35:
        return "medium"
    return "low"


def assess(
    controls: list[WafControl],
    open_finding_rule_ids: set[str],
    known_rule_ids: set[str],
    rule_requires: dict[str, list[str]] | None = None,
    usable_capabilities: set[str] | None = None,
) -> dict[str, PillarAssessment]:
    """Assess the catalogue against a scan's findings + capabilities.

    A control is *measured* when its linked rule exists AND (has no capability
    requirement, or every required capability is usable). A measured control is a
    *gap* if its rule has an open finding this scan, otherwise a *pass*. Unmeasured
    controls are never scored as pass or fail — they widen the confidence band.
    """
    rule_requires = rule_requires or {}
    usable = usable_capabilities if usable_capabilities is not None else set()

    by_pillar: dict[str, list[WafControl]] = {}
    for c in controls:
        by_pillar.setdefault(c.pillar, []).append(c)

    result: dict[str, PillarAssessment] = {}
    for pillar, items in by_pillar.items():
        outcomes: list[ControlOutcome] = []
        measured = passed = gaps = 0
        for c in items:
            is_measured = False
            if c.rule and c.rule in known_rule_ids:
                reqs = rule_requires.get(c.rule, [])
                is_measured = (not reqs) or all(r in usable for r in reqs)
            if is_measured:
                measured += 1
                if c.rule in open_finding_rule_ids:
                    gaps += 1
                    status = "gap"
                else:
                    passed += 1
                    status = "pass"
            else:
                status = "attestation" if c.measurability == "attestation" else "unmeasured"
            outcomes.append(ControlOutcome(control=c, status=status, measured=is_measured))

        total = len(items)
        score = round(100.0 * passed / measured, 1) if measured else 0.0
        low = round(100.0 * passed / total, 1) if total else 0.0
        high = round(100.0 * (passed + (total - measured)) / total, 1) if total else 0.0
        result[pillar] = PillarAssessment(
            pillar=pillar, total=total, measured=measured, passed=passed, gaps=gaps,
            score=score, low=low, high=high, confidence=_confidence(measured, total),
            outcomes=outcomes,
        )
    return result
