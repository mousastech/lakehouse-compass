"""Unit tests for the compute-lever measurement->pricing path (fake Spark)."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages"))

from compass_core.finops_recs.compute_levers import build_compute_recommendations  # noqa: E402


class _Row:
    def __init__(self, d):
        self._d = d

    def asDict(self, recursive=False):
        return dict(self._d)


class _DF:
    def __init__(self, rows):
        self._rows = rows

    def collect(self):
        return [_Row(r) for r in self._rows]


class FakeSpark:
    """Routes a query to a canned row by matching the System Table it hits."""

    def __init__(self, warehouse=None, cluster=None, jobshare=None):
        self.warehouse = warehouse
        self.cluster = cluster
        self.jobshare = jobshare

    def sql(self, q):
        if "query.history" in q:
            return _DF([self.warehouse] if self.warehouse else [])
        if "node_timeline" in q:
            return _DF([self.cluster] if self.cluster else [])
        if "job_task_run_timeline" in q:
            return _DF([self.jobshare] if self.jobshare else [])
        return _DF([])


def _build(spark, compute_rows):
    return build_compute_recommendations(
        spark, scan_id="s1", workspace_id="w1", workspace_name="prod",
        window_days=30, compute_rows=compute_rows,
    )


def test_serverless_warehouse_idle_tail_is_booked():
    # 78.7 active + 1426 warm min, reclaim 536 to 5-min auto-stop; cost $211/mo.
    spark = FakeSpark(warehouse={"active_min": 78.7, "warm_min": 1426.0, "reclaim_min": 536.4, "extra_stops": 40, "observed_days": 29})
    rows = _build(spark, [{"kind": "warehouse", "compute_id": "wh1", "name": "Serverless Starter",
                           "serverless": True, "auto_stop_min": 10, "cost_usd_30d": 211.53, "dbus_30d": 300.0}])
    assert len(rows) == 1
    r = rows[0]
    assert r["rule_id"] == "FIN-103" and r["savings_status"] == "bookable" and r["confidence"] == "high"
    # dpm = 211.53/(78.7+1426)=0.1406; point ~= (536.4 - 40*1)*0.1406
    assert 60 < r["savings_point_usd"] < 80
    assert r["effort_band"] == "trivial"


def test_serverless_at_floor_not_a_candidate():
    spark = FakeSpark(warehouse={"active_min": 100, "warm_min": 200, "reclaim_min": 50, "extra_stops": 1, "observed_days": 20})
    rows = _build(spark, [{"kind": "warehouse", "compute_id": "wh2", "name": "dw", "serverless": True,
                           "auto_stop_min": 5, "cost_usd_30d": 119.0, "dbus_30d": 200.0}])
    assert rows == []  # already at the 5-min floor -> nothing to shorten


def test_classic_warehouse_loose_autostop_is_estimated():
    spark = FakeSpark(warehouse={"active_min": 500, "warm_min": 3000, "reclaim_min": 2000, "extra_stops": 0, "observed_days": 25})
    rows = _build(spark, [{"kind": "warehouse", "compute_id": "wh3", "name": "bi-classic", "serverless": False,
                           "auto_stop_min": 120, "cost_usd_30d": 1500.0, "dbus_30d": 4000.0}])
    assert len(rows) == 1
    r = rows[0]
    assert r["rule_id"] == "FIN-102" and r["savings_status"] == "estimated" and r["confidence"] == "medium"
    assert r["savings_low_usd"] < r["savings_point_usd"]  # real downside band


def test_too_new_warehouse_suppressed():
    spark = FakeSpark(warehouse={"active_min": 10, "warm_min": 200, "reclaim_min": 100, "extra_stops": 0, "observed_days": 2})
    rows = _build(spark, [{"kind": "warehouse", "compute_id": "wh4", "name": "new", "serverless": False,
                           "auto_stop_min": 120, "cost_usd_30d": 900.0, "dbus_30d": 1000.0}])
    assert rows == []  # observed_days < min_observation_days(5)


def test_cluster_idle_no_autoterm_books_and_may_flag_jobs():
    spark = FakeSpark(
        cluster={"total_min": 10000.0, "idle_min": 6000.0, "observed_days": 20},
        jobshare={"njobs": 3, "nruns": 40, "job_min": 9500.0},  # 95% dedicated
    )
    rows = _build(spark, [{"kind": "cluster", "compute_id": "cl1", "name": "shared-ap", "serverless": None,
                           "auto_stop_min": 0, "cost_usd_30d": 2000.0, "dbus_30d": 5000.0, "owner": "eng@x"}])
    ids = {r["rule_id"] for r in rows}
    assert "FIN-101" in ids  # idle cluster, bookable
    fin101 = next(r for r in rows if r["rule_id"] == "FIN-101")
    assert fin101["savings_status"] == "bookable" and fin101["confidence"] == "high"
    assert "FIN-105" in ids  # dedicated jobs on all-purpose cluster
    fin105 = next(r for r in rows if r["rule_id"] == "FIN-105")
    assert fin105["savings_status"] == "bookable"  # dedicated -> realizable


def test_cluster_with_tight_autoterm_not_candidate():
    spark = FakeSpark(cluster={"total_min": 5000.0, "idle_min": 3000.0, "observed_days": 20})
    rows = _build(spark, [{"kind": "cluster", "compute_id": "cl2", "name": "ok", "serverless": None,
                           "auto_stop_min": 15, "cost_usd_30d": 800.0, "dbus_30d": 1000.0}])
    assert rows == []  # 15 <= max_acceptable(60)


def test_query_failure_is_defensive():
    class Boom:
        def sql(self, q):
            raise RuntimeError("no grant")
    rows = _build(Boom(), [{"kind": "warehouse", "compute_id": "x", "name": "x", "serverless": True,
                            "auto_stop_min": 30, "cost_usd_30d": 100.0, "dbus_30d": 100.0}])
    assert rows == []  # never raises
