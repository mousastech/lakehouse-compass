"""Unit tests for the Performance collector — latency summary + compute inventory."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages"))

from compass_core.collectors.performance import PerformanceCollector, _dbr_major  # noqa: E402
from compass_core.models.capability import Availability  # noqa: E402
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


def _handler(*, summary, p90, cost=None, util=None, clusters=None, raise_on_history=False):
    def h(q):
        if "system.compute.clusters" in q:
            return clusters or []
        if "usage_metadata.warehouse_id" in q:
            return cost or []
        if "compute.warehouse_id AS compute_id" in q:
            return util or []
        if raise_on_history and "system.query.history" in q:
            raise RuntimeError("PERMISSION_DENIED on system.query.history")
        if "AS p90" in q:
            return p90
        if "executed_by AS entity" in q:
            return summary
        return []
    return h


def _warehouses(payload):
    def rest(method, path, body=None):
        assert path == "/api/2.0/sql/warehouses"
        return payload
    return rest


def test_dbr_major_parsing():
    assert _dbr_major("14.3.x-scala2.12") == 14
    assert _dbr_major("12.2") == 12
    assert _dbr_major("") is None
    assert _dbr_major("custom") is None


def test_perf_summary_and_perf010():
    spark = _FakeSpark(_handler(
        summary=[{"entity": "a@x.com", "queries": 100, "avg_ms": 5000, "max_ms": 60000}],
        p90=[{"p90": 45000, "total": 500, "slow": 40}],
    ))
    res = PerformanceCollector(workspace_id="w1").collect(spark)
    assert res.inventory["perf_summary"][0]["entity"] == "a@x.com"
    assert "PERF-010" in [f.rule_id for f in res.findings]


def test_compute_inventory_and_health_findings():
    spark = _FakeSpark(_handler(
        summary=[{"entity": "a@x.com", "queries": 10, "avg_ms": 100, "max_ms": 200}],
        p90=[{"p90": 100, "total": 10, "slow": 0}],
        cost=[{"compute_id": "wh1", "cost_usd": 82.9, "dbus": 118.4},
              {"compute_id": "cl1", "cost_usd": 41.2, "dbus": 55.3}],
        util=[{"compute_id": "wh1", "queries": 1373, "avg_ms": 5861, "p90_ms": 12712}],
        clusters=[{"cluster_id": "cl1", "cluster_name": "ds-shared", "auto_termination_minutes": 0,
                   "dbr_version": "12.2.x-scala2.12", "worker_count": 4,
                   "min_autoscale_workers": 2, "max_autoscale_workers": 8, "owned_by": "ana@x.com"}],
    ))
    rest = _warehouses({"warehouses": [
        {"id": "wh1", "name": "classic-wh", "cluster_size": "Small", "enable_serverless_compute": False,
         "auto_stop_mins": 0, "min_num_clusters": 1, "max_num_clusters": 2, "state": "RUNNING"},
        {"id": "wh2", "name": "serverless-wh", "cluster_size": "Small", "enable_serverless_compute": True,
         "auto_stop_mins": 10, "min_num_clusters": 1, "max_num_clusters": 1, "state": "STOPPED"},
    ]})
    res = PerformanceCollector(workspace_id="w1", rest=rest).collect(spark)
    inv = res.inventory["compute_inventory"]
    kinds = sorted({r["kind"] for r in inv})
    assert kinds == ["cluster", "warehouse"]
    wh1 = next(r for r in inv if r["compute_id"] == "wh1")
    assert wh1["cost_usd_30d"] == 82.9 and wh1["queries_30d"] == 1373
    rule_ids = {f.rule_id for f in res.findings}
    assert {"PERF-020", "PERF-021", "PERF-022", "PERF-023"} <= rule_ids


def test_serverless_warehouse_no_health_findings():
    spark = _FakeSpark(_handler(
        summary=[{"entity": "a@x.com", "queries": 10, "avg_ms": 100, "max_ms": 200}],
        p90=[{"p90": 100, "total": 10, "slow": 0}],
        clusters=[],  # serverless-first workspace: no interactive clusters
    ))
    rest = _warehouses({"warehouses": [
        {"id": "wh2", "name": "serverless-wh", "cluster_size": "Small", "enable_serverless_compute": True,
         "auto_stop_mins": 10, "min_num_clusters": 1, "max_num_clusters": 1, "state": "RUNNING"},
    ]})
    res = PerformanceCollector(workspace_id="w1", rest=rest).collect(spark)
    inv = res.inventory["compute_inventory"]
    assert len(inv) == 1 and inv[0]["kind"] == "warehouse"
    rule_ids = {f.rule_id for f in res.findings}
    assert not ({"PERF-020", "PERF-021", "PERF-022", "PERF-023"} & rule_ids)


def test_no_compute_no_inventory():
    # No warehouses (rest=None) and clusters empty → no compute_inventory, no crash.
    spark = _FakeSpark(_handler(
        summary=[{"entity": "a@x.com", "queries": 10, "avg_ms": 100, "max_ms": 200}],
        p90=[{"p90": 100, "total": 10, "slow": 0}],
        clusters=[],
    ))
    res = PerformanceCollector(workspace_id="w1", rest=None).collect(spark)
    assert "compute_inventory" not in res.inventory


def test_query_history_unavailable_is_graceful():
    spark = _FakeSpark(_handler(summary=[], p90=[], raise_on_history=True))
    res = PerformanceCollector(workspace_id="w1").collect(spark)
    assert res.inventory == {}
    assert [c for c in res.capabilities if c.availability == Availability.NOT_AVAILABLE]


def test_perf_rules_registered():
    reg = RuleRegistry()
    for rid in ("PERF-020", "PERF-021", "PERF-022", "PERF-023"):
        r = reg.get(rid)
        assert r is not None and r.domain == "performance"
