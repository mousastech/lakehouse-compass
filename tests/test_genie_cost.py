"""Unit tests for the Genie cost & consumption collector (Genie domain)."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages"))

from compass_core.collectors.genie_cost import GenieCostCollector  # noqa: E402
from compass_core.rules import RuleRegistry  # noqa: E402


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


def _handler(*, summary, per_user):
    """Route each collector query to canned rows by a distinctive substring."""

    def h(q):
        if "code_total_dbus" in q:
            return [{"code_free_dbus": 269.06, "code_billed_dbus": 661.23, "code_total_dbus": 930.29,
                     "code_billed_cost_usd": 46.29, "code_users": 4}]
        if "active_users" in q:
            return summary
        if "run_as_user" in q and "DATE_TRUNC('MONTH'" in q:
            return per_user
        if "usage_date" in q and "billed_cost_usd" in q:
            return [{"usage_date": "2026-09-20", "billed_cost_usd": 5.1, "billed_dbus": 73.2, "free_dbus": 2.0}]
        if "AS surface" in q:
            return [{"surface": "GENIE_CODE", "list_cost": 46.29, "dbus": 661.23}]
        if "AS channel" in q:
            return [{"channel": "UI", "dbus": 661.23}]
        if "u.sku_name AS sku" in q:
            return [{"sku": "GENIE_FREE_USAGE", "dbus": 369.5}]
        if "usage_date" in q:
            return [{"usage_date": "2026-09-20", "list_cost": 5.1}]
        return []

    return h


def test_no_genie_usage_writes_zero_row():
    # Billing resolved but no Genie usage → still writes a zero summary row so live
    # data (honest zeros) wins over the demo fixture in the UI; emits no finding.
    spark = _FakeSpark(_handler(
        summary=[{"billed_cost_usd": 0, "billed_dbus": 0, "free_dbus": 0, "active_users": 0}],
        per_user=[],
    ))
    res = GenieCostCollector(workspace_id="w1").collect(spark)
    rows = res.inventory["genie_cost_summary"]
    assert len(rows) == 1
    assert rows[0]["billed_dbus"] == 0.0 and rows[0]["free_dbus"] == 0.0
    assert res.findings == []


def test_summary_and_breakdowns_populated():
    spark = _FakeSpark(_handler(
        summary=[{"billed_cost_usd": 46.29, "billed_dbus": 661.23, "free_dbus": 369.5, "active_users": 4}],
        per_user=[],
    ))
    res = GenieCostCollector(workspace_id="w1", workspace_name="moi-ai").collect(spark)
    rows = res.inventory["genie_cost_summary"]
    assert len(rows) == 1
    r = rows[0]
    assert r["billed_dbus"] == 661.23
    assert r["active_users"] == 4
    assert r["code_total_dbus"] == 930.29
    assert r["code_billed_cost_usd"] == 46.29
    assert r["code_users"] == 4
    surfaces = json.loads(r["by_surface_json"])
    assert surfaces[0]["surface"] == "GENIE_CODE"
    assert json.loads(r["trend_json"])[0]["list_cost"] == 5.1
    trend = res.inventory["genie_cost_trend"]
    assert len(trend) == 1 and trend[0]["billed_cost_usd"] == 5.1


def test_over_allowance_emits_finding():
    spark = _FakeSpark(_handler(
        summary=[{"billed_cost_usd": 46.29, "billed_dbus": 661.23, "free_dbus": 369.5, "active_users": 2}],
        per_user=[
            {"run_as_user": "a@x.com", "genie_surface": "GENIE_CODE", "free_dbus": 150, "paid_dbus": 500, "billed_cost_usd": 35.0},
            {"run_as_user": "b@x.com", "genie_surface": "GENIE_AGENTS", "free_dbus": 90, "paid_dbus": 0, "billed_cost_usd": 0},
        ],
    ))
    res = GenieCostCollector(workspace_id="w1").collect(spark)
    users = res.inventory["genie_cost_by_user"]
    code = next(u for u in users if u["run_as_user"] == "a@x.com")
    agents = next(u for u in users if u["run_as_user"] == "b@x.com")
    assert code["over_allowance"] is True
    assert code["free_allowance_limit"] == 150
    assert agents["over_allowance"] is False
    assert agents["free_allowance_limit"] is None
    fids = [f.rule_id for f in res.findings]
    assert "GEN-COST-001" in fids


def test_within_free_no_finding():
    spark = _FakeSpark(_handler(
        summary=[{"billed_cost_usd": 0, "billed_dbus": 0, "free_dbus": 120, "active_users": 1}],
        per_user=[
            {"run_as_user": "a@x.com", "genie_surface": "GENIE_CODE", "free_dbus": 120, "paid_dbus": 0, "billed_cost_usd": 0},
        ],
    ))
    res = GenieCostCollector(workspace_id="w1").collect(spark)
    # free_dbus > 0 so it is not skipped; user within allowance → no finding.
    assert res.inventory["genie_cost_by_user"][0]["over_allowance"] is False
    assert [f for f in res.findings if f.rule_id == "GEN-COST-001"] == []


def test_billing_unavailable_is_graceful():
    def boom(_q):
        raise RuntimeError("PERMISSION_DENIED on system.billing.usage")

    res = GenieCostCollector(workspace_id="w1").collect(_FakeSpark(boom))
    assert res.inventory == {}
    assert res.findings == []


def test_gen_cost_001_rule_registered():
    reg = RuleRegistry()
    rule = reg.get("GEN-COST-001")
    assert rule is not None
    assert rule.domain == "genie"
    assert "cost_optimization" in [p.value for p in rule.waf_pillars]
