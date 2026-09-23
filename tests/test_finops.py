"""Unit tests for the FinOps collector — focus on the cost_trend series."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages"))

from compass_core.collectors.finops import FinOpsCollector  # noqa: E402


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


_SUMMARY = [{"product": "APPS", "sku": "APPS_SERVERLESS", "identity": "(unattributed)", "cost_usd": 100.0, "dbus": 200.0}]
_TREND = [
    {"usage_date": "2026-09-20", "product": "APPS", "cost_usd": 12.0, "dbus": 18.0},
    {"usage_date": "2026-09-21", "product": "SQL", "cost_usd": 8.0, "dbus": 10.0},
]


def _handler(*, summary=_SUMMARY, trend=_TREND, detail=None):
    # Note: the summary query has usage_date only in its WHERE; the trend query
    # SELECTs `CAST(u.usage_date AS STRING) AS usage_date` — match on that.
    def h(q):
        if "resource_type" in q:
            return detail or []
        if "AS usage_date" in q:
            return trend
        return summary
    return h


def test_cost_trend_populated():
    res = FinOpsCollector(workspace_id="w1", workspace_name="ws").collect(_FakeSpark(_handler()))
    rows = res.inventory["cost_trend"]
    assert len(rows) == 2
    assert rows[0]["product"] == "APPS" and rows[0]["cost_usd"] == 12.0
    assert rows[0]["workspace_id"] == "w1"


def test_cost_trend_graceful_when_source_raises():
    # trend query raises → collector still returns summary, no cost_trend key, no crash.
    def h(q):
        if "resource_type" in q:
            return []
        if "AS usage_date" in q:
            raise RuntimeError("no usage_metadata")
        return _SUMMARY
    res = FinOpsCollector(workspace_id="w1").collect(_FakeSpark(h))
    assert "cost_summary" in res.inventory
    assert "cost_trend" not in res.inventory


def test_billing_unavailable_is_graceful():
    def boom(_q):
        raise RuntimeError("PERMISSION_DENIED on system.billing.usage")
    res = FinOpsCollector(workspace_id="w1").collect(_FakeSpark(boom))
    assert res.inventory == {}
    assert any(c.availability.value == "NOT_AVAILABLE" for c in res.capabilities)
