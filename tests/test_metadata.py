"""Tag Profile + metadata collector (tag-based monitoring, description quality)."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages"))

from compass_core.collectors.metadata import (  # noqa: E402
    MetadataCollector, QUALITY_CLASSES, effective_roles_sql, quality_case_sql,
)
from compass_core.rules import RuleRegistry  # noqa: E402
from compass_core.tag_profile import load_tag_profile  # noqa: E402
from compass_core.waf import load_controls  # noqa: E402


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


class _Spark:
    """Routes the collector's three queries to canned rows."""

    def __init__(self, facts, examples=(), usage=()):
        self.facts, self.examples, self.usage = list(facts), list(examples), list(usage)
        self.queries = []

    def sql(self, q):
        self.queries.append(q)
        if "AS table_q" in q:
            return _DF(self.facts)
        if "AS names" in q:
            return _DF(self.examples)
        return _DF(self.usage)


def _fact(n, *, table_q="useful", domain=None, layer=None, owner=None, cert=None, useful=5, weak=0, missing=0):
    f = {"c": "cat", "s": "sch", "n": n, "table_q": table_q, "domain": domain, "layer": layer,
         "owner": owner, "cert": cert, "sensitive": 0}
    for q in QUALITY_CLASSES:
        f[f"col_{q}"] = 0
    f["col_useful"], f["col_generic"], f["col_missing"] = useful, weak, missing
    f["col_total"] = useful + weak + missing
    return f


# -- Tag Profile ----------------------------------------------------------------
def test_profile_maps_multilingual_keys_case_insensitively():
    p = load_tag_profile()
    assert p.role_of("dominio_negocio") == "domain"
    assert p.role_of("Camada") == "layer"
    assert p.role_of("certificado") == "certification"
    assert p.role_of("system.certification_status") == "certification"
    assert p.role_of("class.email_address") == "sensitivity"  # prefix match
    assert p.role_of("sap.PersonalData.isPotentiallyPersonal") == "sensitivity"
    assert p.role_of("accelerator") is None
    assert "sim" in p.certified_values and "gold" in p.gold_values
    assert p.inherit_exclude == ["certification"]


def test_profile_override_extends_and_bad_json_keeps_defaults():
    p = load_tag_profile(json.dumps({"roles": {"domain": {"keys": ["BU"]}}, "gold_values": ["platinum"]}))
    assert p.role_of("bu") == "domain" and p.role_of("domain") == "domain"
    assert "platinum" in p.gold_values and "gold" in p.gold_values
    assert load_tag_profile("{not json").role_of("domain") == "domain"


def test_suggest_role_only_for_unmapped_keys():
    p = load_tag_profile()
    assert p.suggest_role("gov_data_domain") == "domain"
    assert p.suggest_role("stage", ["bronze", "gold"]) == "layer"
    assert p.suggest_role("pii_type") == "sensitivity"
    assert p.suggest_role("domain") is None  # already mapped
    assert p.suggest_role("accelerator") is None


def test_role_case_sql_covers_keys_and_prefixes():
    sql = load_tag_profile().role_case_sql("k")
    assert "'dominio_negocio'" in sql and "startswith(lower(k), 'class.')" in sql


# -- SQL builders ---------------------------------------------------------------
def test_effective_roles_inherit_except_certification():
    sql = effective_roles_sql(load_tag_profile(), lambda v: f"system.information_schema.{v}", "1=1")
    assert "catalog_tags" in sql and "schema_tags" in sql and "table_tags" in sql
    # certification only counts when set on the table itself (lvl 3)
    assert "tr.lvl = 3 OR tr.role NOT IN ('certification')" in sql
    assert "ORDER BY tr.lvl DESC" in sql  # most specific wins


def test_quality_case_order_and_no_backslashes():
    sql = quality_case_sql("x", "nm", "bp")
    order = [sql.index(f"'{q}'") for q in ("missing", "placeholder", "echo", "generic", "short", "boilerplate", "useful")]
    assert order == sorted(order)
    assert "\\" not in sql  # Spark unescapes string literals; patterns use [.] classes instead


# -- collector findings -----------------------------------------------------------
def test_gold_rules_fire_and_scope_to_gold():
    facts = [
        _fact("g1", layer="gold", domain="Sales", owner=None, cert="certified", useful=2, weak=3),
        _fact("g2", layer="gold", domain="Sales", owner=None, cert=None, useful=1, weak=4),
        _fact("b1", layer="bronze", domain="Ops", owner="ana", useful=0, weak=0, missing=10),
    ]
    res = MetadataCollector(load_tag_profile(), "ws1", "s1").collect(_Spark(facts))
    by = {f.rule_id: f for f in res.findings}
    assert by["GOV-030"].evidence["without_owner"] == 2
    assert by["GOV-031"].evidence["uncertified"] == 1
    assert by["GOV-033"].evidence["sample"] == ["Sales"]  # Ops has an owner
    assert by["GOV-040"].evidence["scope"] == "gold" and by["GOV-040"].evidence["weak"] == 7
    assert "GOV-016" not in by  # no REST → not evaluated, never fabricated
    assert {c.id: c.availability.value for c in res.capabilities}["tag_policies"] == "NOT_AVAILABLE"


def test_gov016_ignores_system_tags_and_used_keys():
    pages = [{"tag_policies": [{"tag_key": "class.email_address"}, {"tag_key": "camada"}],
              "next_page_token": "p2"},
             {"tag_policies": [{"tag_key": "cost_center"}, {"tag_key": "system.certification_status"}]}]
    calls = []

    def rest(method, path, body=None):
        calls.append(path)
        return pages[len(calls) - 1]

    usage = [{"tag_key": "Camada", "assignments": 6, "distinct_values": 1, "securable_types": "schema",
              "top_values_json": json.dumps([{"v": "gold", "n": 6}])}]
    res = MetadataCollector(load_tag_profile(), "ws1", "s1", rest=rest).collect(_Spark([_fact("t")], usage=usage))
    gov016 = next(f for f in res.findings if f.rule_id == "GOV-016")
    assert gov016.evidence["governed_custom_keys"] == 2 and gov016.evidence["sample_unused"] == ["cost_center"]
    assert "page_token=p2" in calls[1]
    inv = res.inventory["tag_inventory"][0]
    assert inv["role"] == "layer" and inv["governed"] is True


def test_quality_metrics_and_rollup_shape():
    facts = [_fact("a", domain="Sales", useful=3, weak=1, missing=1), _fact("b", table_q="missing", useful=0, missing=4)]
    examples = [{"q": "generic", "text": "Name of the column.", "n": 6, "names": 3}]
    res = MetadataCollector(load_tag_profile(), "ws1", "s1").collect(_Spark(facts, examples=examples))
    m = {r["metric"]: r for r in res.inventory["governance_metrics"]}
    assert m["column_total"]["value"] == 9 and m["column_useful_pct"]["value"] == 33.3
    assert m["table_documented_pct"]["value"] == 50.0
    assert json.loads(m["weak_comment_examples"]["detail"])[0]["text"] == "Name of the column."
    dom = {r["value"]: r for r in res.inventory["tag_rollup"] if r["role"] == "domain"}
    assert dom["Sales"]["tables"] == 1 and dom[""]["tables"] == 1  # '' = untagged bucket


def test_no_findings_when_metadata_is_healthy():
    facts = [_fact("g", layer="gold", domain="Sales", owner="ana", cert="certified", useful=10)]
    res = MetadataCollector(load_tag_profile(), "ws1", "s1").collect(_Spark(facts))
    assert res.findings == []


def test_new_rules_registered_and_in_waf_catalogue():
    reg = RuleRegistry()
    for rid in ("GOV-016", "GOV-030", "GOV-031", "GOV-033", "GOV-040"):
        assert reg.get(rid).domain == "governance"
    assert "tag_policies" in reg.get("GOV-016").requires
    waf_rules = {c.rule for c in load_controls()}
    assert {"GOV-030", "GOV-031", "GOV-033", "GOV-040"} <= waf_rules
