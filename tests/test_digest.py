"""Unit tests for the proactive status digest (compass_core.digest)."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages"))

from compass_core.digest import build_digest, narrative  # noqa: E402


def _digest():
    return build_digest(
        workspace_name="fevm-moi-ai",
        current={"overall_score": 82.0, "coverage_pct": 85.7, "crit": 1, "high": 3,
                 "med": 4, "low": 2, "generated_at": "2026-09-15T12:00:00Z"},
        previous={"overall_score": 88.0, "coverage_pct": 85.7, "crit": 0, "high": 2},
        waf_pillars=[
            {"pillar": "security", "score": 52.0, "findings": 4, "critical_findings": 1, "rules": 8},
            {"pillar": "cost_optimization", "score": 86.0, "findings": 2, "critical_findings": 0, "rules": 6},
            {"pillar": "reliability", "score": 100.0, "findings": 0, "critical_findings": 0, "rules": 1},
            {"pillar": "interoperability_usability", "score": 100.0, "findings": 0, "critical_findings": 0, "rules": 2},
        ],
        current_rule_ids={"SEC-027", "SEC-029", "FIN-027"},
        previous_rule_ids={"SEC-027", "AIG-003"},
        criticals=[{"rule_id": "SEC-027", "title": "SP holds ALL PRIVILEGES", "resource": "catalog: main"}],
    )


def test_digest_score_delta_and_changes():
    d = _digest()
    assert d["score"] == 82.0
    assert d["score_delta"] == -6.0  # dropped since last scan
    assert d["changes"]["new"] == ["FIN-027", "SEC-029"]
    assert d["changes"]["resolved"] == ["AIG-003"]
    assert d["changes"]["still_open"] == ["SEC-027"]


def test_digest_weakest_pillars_ignores_unmeasured():
    d = _digest()
    pillars = [p["pillar"] for p in d["weakest_pillars"]]
    # security (52, 8 rules) is weakest and measured; reliability (100 but only 1
    # rule) must NOT headline as "strong" — it's flagged limited instead.
    assert pillars[0] == "security"
    assert "reliability" not in pillars
    assert "reliability" in d["limited_coverage_pillars"]


def test_digest_first_scan_has_no_trend():
    d = build_digest(
        workspace_name="ws", current={"overall_score": 90.0, "coverage_pct": 70.0},
        previous=None, waf_pillars=[], current_rule_ids={"A-1"}, previous_rule_ids=set(),
        criticals=[],
    )
    assert d["score_delta"] is None
    assert d["changes"]["new"] == ["A-1"]


def test_narrative_is_plain_text_with_criticals():
    text = narrative(_digest())
    assert "Health score 82.0/100" in text
    assert "down -6.0" in text
    assert "[SEC-027]" in text
    assert "Security, Privacy & Compliance" in text
