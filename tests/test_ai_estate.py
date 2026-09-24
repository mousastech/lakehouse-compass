"""Unit tests for the AI Estate collector — AI Gateway config + endpoint usage."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages"))

from compass_core.collectors.ai_estate import AiEstateCollector  # noqa: E402


class _Row:
    def __init__(self, d): self._d = d
    def asDict(self, recursive=False): return dict(self._d)


class _DF:
    def __init__(self, rows): self._rows = rows
    def collect(self): return [_Row(r) for r in self._rows]


class _Spark:
    def __init__(self, handler): self._h = handler
    def sql(self, q): return _DF(self._h(q))


def _handler(*, usage=None, top=None, served_raises=False):
    ENTITIES = [
        {"endpoint_name": "ep-a", "entity_type": "CUSTOM_MODEL", "created_by": "u@x.com", "entity_name": "a", "change_time": "t"},
        {"endpoint_name": "ep-b", "entity_type": "EXTERNAL_MODEL", "created_by": "svc", "entity_name": "b", "change_time": "t"},
    ]

    def h(q):
        if "created_by" in q:
            if served_raises:
                raise RuntimeError("no serving access")
            return ENTITIES
        if "requests_30d" in q:
            return usage or []
        if "endpoint_usage" in q and "AS requester" in q:
            return top or []
        return []

    return h


_GW = {
    "ep-a": {"ai_gateway": {"usage_tracking_config": {"enabled": True}, "inference_table_config": {"enabled": True}, "guardrails": {"input": {}}, "rate_limits": [{"calls": 100}]}},
    "ep-b": {"ai_gateway": {"usage_tracking_config": {"enabled": True}}},  # partial
}


def _rest(method, path, body=None):
    name = path.rsplit("/", 1)[-1]
    return _GW.get(name, {})


def test_gateway_and_usage_populate():
    spark = _Spark(_handler(
        usage=[
            {"endpoint_name": "ep-a", "requests_30d": 100, "requesters": 3, "in_tokens": 5000, "out_tokens": 1200, "error_rate": 2.0, "last_request": "2026-09-24T10:00"},
        ],
        top=[
            {"endpoint_name": "ep-a", "requester": "svc@x", "requests": 80},
            {"endpoint_name": "ep-a", "requester": "u@x.com", "requests": 20},
        ],
    ))
    res = AiEstateCollector(workspace_id="w1", rest=_rest).collect(spark)
    gw = {r["endpoint_name"]: r for r in res.inventory["ai_gateway_config"]}
    assert gw["ep-a"]["governed"] is True  # tracking+payload+guardrails
    assert gw["ep-b"]["governed"] is False  # only tracking
    assert gw["ep-b"]["payload_logging"] is False
    usage = res.inventory["endpoint_usage_summary"]
    assert usage[0]["endpoint_name"] == "ep-a" and usage[0]["requests_30d"] == 100
    reqs = json.loads(usage[0]["top_requesters_json"])
    assert reqs[0]["requester"] == "svc@x" and reqs[0]["requests"] == 80


def test_no_rest_skips_gateway():
    res = AiEstateCollector(workspace_id="w1", rest=None).collect(_Spark(_handler(usage=[], top=[])))
    assert "ai_gateway_config" not in res.inventory
    # inventory + usage still resolve
    assert "ai_estate_inventory" in res.inventory
    assert res.inventory.get("endpoint_usage_summary") == []


def test_usage_unavailable_is_graceful():
    def h(q):
        if "created_by" in q:
            return [{"endpoint_name": "ep-a", "entity_type": "CUSTOM_MODEL", "created_by": "u@x.com", "entity_name": "a", "change_time": "t"}]
        raise RuntimeError("endpoint_usage not granted")
    res = AiEstateCollector(workspace_id="w1", rest=_rest).collect(_Spark(h))
    assert "ai_estate_inventory" in res.inventory
    assert "endpoint_usage_summary" not in res.inventory  # degraded, no crash


def test_served_entities_unavailable_returns_early():
    res = AiEstateCollector(workspace_id="w1", rest=_rest).collect(_Spark(_handler(served_raises=True)))
    assert res.inventory == {}
