"""Unit tests for the WAF control catalogue (Phase 2)."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages"))

from compass_core.waf import (  # noqa: E402
    load_controls, assess, PROVENANCE, MEASURABILITY,
)
from compass_core.models.rule import WafPillar  # noqa: E402
from compass_core.rules import RuleRegistry  # noqa: E402

PILLAR_SLUGS = {p.value for p in WafPillar}
SEVS = {"critical", "high", "medium", "low", "info"}


def test_catalogue_loads_and_covers_all_seven_pillars():
    controls = load_controls()
    assert len(controls) >= 55
    pillars = {c.pillar for c in controls}
    assert pillars == PILLAR_SLUGS, f"catalogue must cover all 7 pillars, got {pillars}"


def test_controls_are_well_formed():
    ids = set()
    for c in load_controls():
        assert c.id and c.id not in ids, f"duplicate/empty control id {c.id}"
        ids.add(c.id)
        assert c.pillar in PILLAR_SLUGS, c.id
        assert c.provenance in PROVENANCE, c.id
        assert c.measurability in MEASURABILITY, c.id
        assert c.severity in SEVS, c.id
        assert c.title and c.criteria and c.doc_url, c.id


def test_linked_rules_exist_in_registry():
    reg = RuleRegistry()
    known = {r.id for r in reg.all()}
    for c in load_controls():
        if c.rule is not None:
            assert c.rule in known, f"{c.id} links unknown rule {c.rule}"
            # A control that links a rule should be automated, not attestation-only.
            assert c.measurability in ("system_table", "rest_api", "derived"), c.id


def test_assess_ranges_and_status():
    reg = RuleRegistry()
    controls = load_controls()
    known = {r.id for r in reg.all()}
    requires = {r.id: [x for x in r.requires] for r in reg.all()}
    # Pretend every capability is usable and one rule has an open finding.
    all_caps = set()
    for reqs in requires.values():
        all_caps.update(reqs)
    result = assess(controls, open_finding_rule_ids={"SEC-027"},
                    known_rule_ids=known, rule_requires=requires, usable_capabilities=all_caps)
    assert set(result.keys()) == PILLAR_SLUGS
    for pa in result.values():
        assert pa.total > 0
        assert 0 <= pa.measured <= pa.total
        assert 0.0 <= pa.low <= pa.score <= pa.high <= 100.0, pa.pillar
        assert pa.confidence in ("high", "medium", "low")
    # SEC-027 open finding => the SCP-IAM-02 control is a gap in security.
    sec = result["security"]
    gap_ids = [o.control.id for o in sec.outcomes if o.status == "gap"]
    assert "SCP-IAM-02" in gap_ids


def test_unmeasured_when_capability_missing():
    reg = RuleRegistry()
    controls = load_controls()
    known = {r.id for r in reg.all()}
    requires = {r.id: [x for x in r.requires] for r in reg.all()}
    # No capabilities usable => rules that require a capability are unmeasured.
    result = assess(controls, open_finding_rule_ids=set(),
                    known_rule_ids=known, rule_requires=requires, usable_capabilities=set())
    # Genie-linked controls require the 'genie' capability => unmeasured with no caps.
    dg = result["data_ai_governance"]
    genie_ctl = next(o for o in dg.outcomes if o.control.id == "DG-AI-01")
    assert genie_ctl.measured is False
