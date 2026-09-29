"""Unit tests for the clean-room FinOps recommendation engine (model + savings)."""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages"))

from compass_core.finops_recs import Recommendation, nba_score  # noqa: E402
from compass_core.finops_recs import savings as sv  # noqa: E402


# --------------------------------------------------------------------------- model
def _rec(**kw):
    base = dict(
        rule_id="FIN-102",
        rule_title="Warehouse auto-stop too loose",
        category="sql",
        resource_type="warehouse",
        resource_id="wh-1",
        resource_name="analytics",
        why="idle warm time",
        how="set auto-stop to 10 min",
        monthly_spend_usd=1000.0,
        savings_point_usd=300.0,
        savings_status="estimated",
        confidence="medium",
        effort_band="trivial",
        priority="MEDIUM",
    )
    base.update(kw)
    return Recommendation(**base)


def test_band_defaults_to_point_when_not_widened():
    r = _rec(savings_low_usd=None, savings_high_usd=None)
    assert r.savings_low_usd == r.savings_point_usd == r.savings_high_usd == 300.0


def test_nba_formula_savings_over_effort_times_priority():
    # trivial=1, HIGH mult=1.25
    assert nba_score(300.0, "trivial", "HIGH") == pytest.approx(375.0)
    # medium=3, MEDIUM mult=1.0
    assert nba_score(300.0, "medium", "MEDIUM") == pytest.approx(100.0)
    r = _rec(savings_point_usd=300.0, effort_band="trivial", priority="HIGH")
    assert r.nba == pytest.approx(375.0)
    assert r.effort_score == 1


def test_recommendation_id_is_stable_and_scoped():
    a = _rec(scan_id="s1", workspace_id="w1", resource_id="wh-1")
    b = _rec(scan_id="s1", workspace_id="w1", resource_id="wh-1")
    c = _rec(scan_id="s1", workspace_id="w2", resource_id="wh-1")
    assert a.recommendation_id() == b.recommendation_id()
    assert a.recommendation_id() != c.recommendation_id()


def test_to_row_is_json_serializable_and_flat():
    r = _rec(evidence={"reclaimable_min": 4200, "rate": 0.07})
    row = r.to_row()
    assert row["rule_id"] == "FIN-102"
    assert row["effort_score"] == 1
    assert row["nba_score"] == r.nba
    # evidence is a JSON string, never a nested dict (Delta schema is flat)
    assert isinstance(row["evidence_json"], str)
    assert json.loads(row["evidence_json"])["reclaimable_min"] == 4200


def test_bad_enums_rejected():
    with pytest.raises(ValueError):
        _rec(confidence="87%")
    with pytest.raises(ValueError):
        _rec(savings_status="maybe")
    with pytest.raises(ValueError):
        _rec(effort_band="epic")


# ------------------------------------------------------------------------- savings
def test_cluster_autotermination_nets_restart_penalty_and_is_bookable():
    # 1000 idle min, $0.05/min, 4 gaps -> penalty 4*5=20 min -> 980 min net
    p = sv.cluster_autotermination_savings(1000.0, 0.05, reclaimed_gaps=4)
    assert p.status == "bookable" and p.confidence == "high"
    assert p.point == pytest.approx(980 * 0.05, abs=0.01)
    assert p.low <= p.point <= p.high


def test_warehouse_autostop_classic_is_estimated_medium_with_downside_band():
    p = sv.warehouse_autostop_savings(2000.0, 0.10)
    assert p.status == "estimated" and p.confidence == "medium"
    assert p.point == pytest.approx(2000 * 0.10 * 0.97, abs=0.01)
    assert p.low < p.point  # a real downside band, not collapsed


def test_serverless_autostop_bookable_no_restart_penalty_dominates():
    p = sv.warehouse_autostop_serverless_savings(600.0, 0.08, extra_restarts=2)
    assert p.status == "bookable" and p.confidence == "high"
    assert p.point == pytest.approx((600 - 2 * 1) * 0.08, abs=0.01)


def test_idle_serving_endpoint_books_full_measured_cost():
    p = sv.idle_serving_endpoint_savings(420.0)
    assert p.status == "bookable" and p.confidence == "high"
    assert p.point == p.low == p.high == 420.0


def test_interactive_to_job_dedicated_books_full_gap_shared_floors_at_zero():
    ded = sv.interactive_to_job_savings(1000.0, 0.55, 0.30, resource_monthly_spend=900.0, dedicated=True)
    assert ded.status == "bookable" and ded.point == pytest.approx(250.0)  # 1000*(0.55-0.30)
    sha = sv.interactive_to_job_savings(1000.0, 0.55, 0.30, resource_monthly_spend=900.0, dedicated=False)
    assert sha.status == "estimated" and sha.low == 0.0 and sha.high == pytest.approx(250.0)


def test_interactive_to_job_capped_at_resource_spend():
    p = sv.interactive_to_job_savings(100000.0, 0.55, 0.30, resource_monthly_spend=400.0, dedicated=True)
    assert p.point == 400.0  # never exceed the resource's own avoidable spend


def test_untagged_priority_tracks_spend_not_tag_count():
    assert sv.untagged_spend_priority(1500) == "HIGH"
    assert sv.untagged_spend_priority(300) == "MEDIUM"
    assert sv.untagged_spend_priority(60) == "LOW"


# ------------------------------------------------------------------------- builder
from compass_core.finops_recs.builder import build_recommendations  # noqa: E402


def _build(**kw):
    base = dict(scan_id="s1", workspace_id="w1", workspace_name="prod", window_days=30)
    base.update(kw)
    return build_recommendations(**base)


def test_idle_endpoint_zero_traffic_is_booked_high():
    rows = _build(
        endpoint_usage=[{"endpoint_name": "fraud-v2", "requests_30d": 0}],
        cost_detail=[
            {"resource_type": "serving_endpoint", "resource_name": "fraud-v2", "owner": "ml@x", "cost_usd": 420.0}
        ],
    )
    assert len(rows) == 1
    r = rows[0]
    assert r["rule_id"] == "FIN-104"
    assert r["savings_status"] == "bookable" and r["confidence"] == "high"
    assert r["savings_point_usd"] == 420.0
    assert r["priority"] == "MEDIUM"  # 420 -> [100,500)


def test_busy_endpoint_is_not_recommended():
    rows = _build(
        endpoint_usage=[{"endpoint_name": "live", "requests_30d": 90000}],
        cost_detail=[{"resource_type": "serving_endpoint", "resource_name": "live", "owner": "ml@x", "cost_usd": 999.0}],
    )
    assert rows == []


def test_cheap_idle_endpoint_below_floor_skipped():
    rows = _build(
        endpoint_usage=[{"endpoint_name": "tiny", "requests_30d": 0}],
        cost_detail=[{"resource_type": "serving_endpoint", "resource_name": "tiny", "owner": "ml@x", "cost_usd": 5.0}],
    )
    assert rows == []


def test_untagged_spend_advisory_zero_savings_ranks_on_spend():
    rows = _build(
        cost_detail=[
            {"resource_type": "job", "resource_name": "etl-nightly", "owner": "", "tags_json": "{}", "cost_usd": 1500.0, "dbus": 100.0},
        ]
    )
    assert len(rows) == 1
    r = rows[0]
    assert r["rule_id"] == "FIN-027"
    assert r["savings_status"] == "advisory" and r["savings_point_usd"] == 0.0
    assert r["priority"] == "HIGH"  # >= 1000/mo
    # Advisory books $0 but must still rank on spend at risk (not collapse to 0).
    assert r["nba_score"] > 0


def test_owner_identity_or_tag_makes_spend_attributable():
    # has run-as owner
    rows = _build(cost_detail=[{"resource_type": "job", "resource_name": "j1", "owner": "svc@x", "tags_json": "{}", "cost_usd": 2000.0}])
    assert rows == []
    # has an owner tag (case-insensitive key)
    rows = _build(cost_detail=[{"resource_type": "job", "resource_name": "j2", "owner": "", "tags_json": '{"Team":"data"}', "cost_usd": 2000.0}])
    assert rows == []


def test_rows_sorted_by_nba_desc():
    rows = _build(
        endpoint_usage=[
            {"endpoint_name": "big", "requests_30d": 0},
            {"endpoint_name": "small", "requests_30d": 0},
        ],
        cost_detail=[
            {"resource_type": "serving_endpoint", "resource_name": "big", "cost_usd": 800.0},
            {"resource_type": "serving_endpoint", "resource_name": "small", "cost_usd": 60.0},
            {"resource_type": "cluster", "resource_name": "untagged", "owner": "", "tags_json": "{}", "cost_usd": 300.0},
        ],
    )
    nbas = [r["nba_score"] for r in rows]
    assert nbas == sorted(nbas, reverse=True)
