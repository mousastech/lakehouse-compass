"""Unit tests for the Genie per-space inventory builder."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages"))

from compass_core.genie_gov import build_space_inventory, setup_score, usage_status  # noqa: E402


def test_setup_score_rewards_description_and_grounding():
    assert setup_score(False, 0) == 0
    assert setup_score(True, 0) == 45
    assert setup_score(False, 1) == 35
    assert setup_score(True, 1) == 80
    assert setup_score(True, 3) == 100
    assert setup_score(True, 50) == 100  # capped


def test_usage_status_bands():
    assert usage_status(0, 0) == "Unused"
    assert usage_status(5, 1) == "Low use"
    assert usage_status(60, 1) == "Active"      # many messages
    assert usage_status(10, 3) == "Active"      # or enough distinct users


def test_build_joins_usage_cost_and_sorts_by_msgs():
    rows = build_space_inventory(
        scan_id="s1", workspace_id="w1", workspace_name="prod",
        space_rows=[
            {"space_id": "a", "title": "Busy", "has_description": True, "tables": 3, "owner": "u@x"},
            {"space_id": "b", "title": "Quiet", "has_description": False, "tables": 0},
        ],
        usage_by_space={
            "a": {"msgs_30d": 80, "users_30d": 4, "msgs_7d": 30, "msgs_prev_7d": 20},
            "b": {"msgs_30d": 0, "users_30d": 0, "msgs_7d": 0, "msgs_prev_7d": 0},
        },
        cost_by_space={"a": {"billed": 12.5, "free_value": 3.0}},
    )
    assert [r["space_id"] for r in rows] == ["a", "b"]  # busy first
    a = rows[0]
    assert a["usage_status"] == "Active" and a["setup_score"] == 100
    assert a["trend_pct"] == 50.0 and a["cost_usd_30d"] == 12.5 and a["owner"] == "u@x"
    assert a["billed_usd"] == 12.5 and a["free_value_usd"] == 3.0
    b = rows[1]
    assert b["usage_status"] == "Unused" and b["setup_score"] == 0 and b["cost_usd_30d"] == 0.0
    assert b["billed_usd"] == 0.0 and b["free_value_usd"] == 0.0


def test_trend_handles_zero_prior_week():
    rows = build_space_inventory(
        scan_id="s", workspace_id="w", workspace_name="p",
        space_rows=[{"space_id": "x", "title": "New", "has_description": True, "tables": 1}],
        usage_by_space={"x": {"msgs_30d": 5, "users_30d": 1, "msgs_7d": 5, "msgs_prev_7d": 0}},
    )
    assert rows[0]["trend_pct"] == 100.0


def test_empty_and_missing_space_id_is_safe():
    assert build_space_inventory(scan_id="s", workspace_id="w", workspace_name="p") == []
    rows = build_space_inventory(
        scan_id="s", workspace_id="w", workspace_name="p",
        space_rows=[{"space_id": "", "title": "bad"}, {"title": "no id"}],
    )
    assert rows == []
