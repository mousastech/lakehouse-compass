"""Unit tests for the scoring model."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages"))

from compass_core.models.finding import Finding, Severity, Status  # noqa: E402
from compass_core.scoring import DOMAIN_WEIGHTS, overall_score, score_domain  # noqa: E402


def test_weights_sum_to_100():
    assert sum(DOMAIN_WEIGHTS.values()) == 100


def test_clean_domain_scores_100():
    ds = score_domain("security", [])
    assert ds.score == 100.0
    assert ds.weight == 25


def test_critical_finding_penalizes():
    f = Finding(
        id="x",
        rule_id="SEC-027",
        domain="security",
        title="t",
        severity=Severity.CRITICAL,
        resource="r",
    )
    ds = score_domain("security", [f])
    assert ds.score == 82.0  # 100 - 18
    assert ds.critical_findings == 1


def test_resolved_findings_do_not_penalize():
    f = Finding(
        id="x",
        rule_id="SEC-027",
        domain="security",
        title="t",
        severity=Severity.CRITICAL,
        resource="r",
        status=Status.RESOLVED,
    )
    ds = score_domain("security", [f])
    assert ds.score == 100.0


def test_overall_is_weighted_average_and_bounded():
    findings = [
        Finding(
            id="a",
            rule_id="SEC-027",
            domain="security",
            title="t",
            severity=Severity.CRITICAL,
            resource="r",
        )
    ]
    score = overall_score(findings, coverage_pct=80.0)
    assert 0 <= score.overall <= 100
    assert score.coverage_pct == 80.0
    # Only security penalized (82), other domains 100 -> weighted avg < 100.
    assert score.overall < 100
