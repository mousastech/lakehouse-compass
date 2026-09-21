"""Unit tests for the Genie Ontology Readiness port (pure scoring methodology)."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages"))

from compass_core.collectors.genie_readiness import (  # noqa: E402
    PILLARS, LEVEL_LABELS, GenieReadinessCollector,
    level_from_score, readiness_stage, _join_names, _pct,
)
from compass_core.rules import RuleRegistry  # noqa: E402


# -- minimal fake Spark (canned rows per query) -----------------------------
class _FakeRow:
    def __init__(self, d):
        self._d = d

    def asDict(self, recursive=False):
        return dict(self._d)


class _FakeDF:
    def __init__(self, rows):
        self._rows = rows

    def collect(self):
        return [_FakeRow(r) for r in self._rows]


class _FakeSpark:
    def __init__(self, handler):
        self._handler = handler

    def sql(self, query):
        return _FakeDF(self._handler(query))


def test_weights_sum_to_100():
    assert sum(p["weight"] for p in PILLARS) == 100
    assert len(PILLARS) == 7


def test_level_from_score_thresholds():
    assert level_from_score(0) == 0
    assert level_from_score(1) == 1
    assert level_from_score(39.9) == 1
    assert level_from_score(40) == 2
    assert level_from_score(65) == 3
    assert level_from_score(85) == 4
    assert LEVEL_LABELS[level_from_score(90)] == "Optimized"


def test_readiness_stage_bands():
    assert readiness_stage(0)[0] == "Foundation building"
    assert readiness_stage(34.9)[0] == "Foundation building"
    assert readiness_stage(35)[0] == "Core foundation in place"
    assert readiness_stage(55)[0] == "Semantics and Genie forming"
    assert readiness_stage(72)[0] == "Curated and validating"
    assert readiness_stage(85)[0] == "Ontology-ready"


def test_join_names_and_pct():
    assert _join_names(["A"]) == "A"
    assert _join_names(["A", "B"]) == "A and B"
    assert _join_names(["A", "B", "C"]) == "A, B, and C"
    assert _pct(1, 4) == 25.0
    assert _pct(0, 0) == 0.0


def test_genie_agents_active_can_be_below_total():
    """Fix #1: roster uses a wider lookback than the 30d activity window, so
    `active` can legitimately be < `total` (no forced 100)."""
    col = GenieReadinessCollector(workspace_id="123")
    captured = {}

    def handler(q):
        captured["q"] = q
        return [{"total": 2, "active_30d": 0}]

    probe = col._p_genie_agents(_FakeSpark(handler))
    # roster window (180d) and activity window (30d) must be distinct predicates.
    assert "INTERVAL 30 DAYS" in captured["q"]
    assert "INTERVAL 180 DAYS" in captured["q"]
    assert probe["available"] is True
    assert probe["metrics"]["genie_agents"] == 2
    assert probe["metrics"]["active_30d"] == 0
    assert probe["score"] == 40.0  # total>0 (+40) only; not inflated to 100
    assert any("none were active" in g for g in probe["gaps"])


def test_adoption_emits_gap_at_zero_activity():
    """Fix #3: adoption pillar surfaces a gap when activity is absent."""
    col = GenieReadinessCollector(workspace_id="123")

    def handler(q):
        return [{"v": 0}]  # active_users == 0 and queries_30d == 0

    probe = col._p_adoption(_FakeSpark(handler))
    assert probe["available"] is True
    assert probe["score"] == 0.0
    assert probe["gaps"], "adoption should surface a gap at zero activity"
    assert any("No active users" in g or "No query activity" in g for g in probe["gaps"])


def test_readiness_rules_registered_and_mapped():
    reg = RuleRegistry()
    for rid in ("GEN-READY-UC", "GEN-READY-METADATA", "GEN-READY-RELATIONSHIPS",
                "GEN-READY-METRICS", "GEN-READY-AGENTS", "GEN-READY-DOMAINS", "GEN-READY-ADOPTION"):
        r = reg.get(rid)
        assert r is not None, rid
        assert r.domain == "genie_readiness"
        assert r.waf_pillars, f"{rid} not mapped to a WAF pillar"
