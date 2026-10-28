"""Tag Profile + metadata collector (tag-based monitoring, description quality)."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages"))

from compass_core.collectors.metadata import (  # noqa: E402
    MetadataCollector, QUALITY_CLASSES, effective_roles_sql, quality_case_sql, tag_hygiene,
)
from compass_core.collectors.protection import ProtectionCollector, evaluate_protection  # noqa: E402
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
    """Routes the collector's queries to canned rows."""

    def __init__(self, facts, examples=(), usage=(), kv=()):
        self.facts, self.examples, self.usage, self.kv = list(facts), list(examples), list(usage), list(kv)
        self.queries = []

    def sql(self, q):
        self.queries.append(q)
        if "AS table_q" in q:
            return _DF(self.facts)
        if "AS names" in q:
            return _DF(self.examples)
        if "ORDER BY n DESC LIMIT" in q:
            return _DF(self.kv)
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


def _policy_rest(pages, policies=None):
    """Fake REST: paginated list for /tag-policies?..., single policy for /tag-policies/<key>."""
    calls = []

    def rest(method, path, body=None):
        calls.append(path)
        if "?" in path:
            return pages[sum(1 for c in calls if "?" in c) - 1]
        key = path.rsplit("/", 1)[-1]
        return (policies or {}).get(key, {})
    return rest, calls


def test_gov016_ignores_system_tags_and_used_keys():
    pages = [{"tag_policies": [{"tag_key": "class.email_address"}, {"tag_key": "camada"}],
              "next_page_token": "p2"},
             {"tag_policies": [{"tag_key": "cost_center"}, {"tag_key": "system.certification_status"}]}]
    rest, calls = _policy_rest(pages)
    usage = [{"tag_key": "camada", "assignments": 6, "distinct_values": 1, "securable_types": "schema",
              "top_values_json": json.dumps([{"v": "gold", "n": 6}])}]
    res = MetadataCollector(load_tag_profile(), "ws1", "s1", rest=rest).collect(_Spark([_fact("t")], usage=usage))
    gov016 = next(f for f in res.findings if f.rule_id == "GOV-016")
    assert gov016.evidence["governed_custom_keys"] == 2 and gov016.evidence["sample_unused"] == ["cost_center"]
    assert any("page_token=p2" in c for c in calls)
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
    for rid in ("GOV-034", "GOV-035", "GOV-036", "SEC-040", "SEC-041", "SEC-042"):
        assert reg.get(rid) is not None, rid
    assert {"GOV-034", "GOV-035", "GOV-036", "SEC-040", "SEC-042"} <= waf_rules


# -- Phase 2: tag hygiene ------------------------------------------------------------
def test_hygiene_flags_variants_multikey_roles_and_value_case():
    kv = [{"k": "Camada", "v": "Gold", "n": 2}, {"k": "camada", "v": "gold", "n": 4},
          {"k": "data_layer", "v": "gold", "n": 1}, {"k": "class.email_address", "v": None, "n": 9},
          {"k": "Product", "v": "x", "n": 1}]
    h = tag_hygiene(load_tag_profile(), kv, governed={"camada", "product"}, allowed={})
    variants = {tuple(v["keys"]) for v in h["drift"]["key_variants"]}
    assert ("Camada", "camada") in variants
    assert ("Product", "product") in variants  # ungoverned spelling in use vs governed key
    assert {"role": "layer", "keys": ["Camada", "camada", "data_layer"]} in h["drift"]["roles_multi_key"]
    assert {"role": "layer", "values": ["Gold", "gold"]} in h["drift"]["value_variants"]
    # system tags never count
    assert all("class.email_address" not in v["keys"] for v in h["drift"]["key_variants"])


def test_hygiene_ignores_two_governed_spellings_when_only_one_is_used():
    h = tag_hygiene(load_tag_profile(), [{"k": "domain", "v": "sales", "n": 1}],
                    governed={"domain", "Domain"}, allowed={})
    assert h["drift"]["key_variants"] == []


def test_hygiene_invalid_values_and_governed_share():
    kv = [{"k": "camada", "v": "gold", "n": 4}, {"k": "camada", "v": "platinum", "n": 2},
          {"k": "phi", "v": "anything", "n": 1}, {"k": "free", "v": "x", "n": 3}]
    h = tag_hygiene(load_tag_profile(), kv, governed={"camada", "phi"},
                    allowed={"camada": ["bronze", "silver", "gold"], "phi": []})
    assert h["invalid"] == [{"key": "camada", "assignments": 2, "values": ["platinum"],
                             "allowed": ["bronze", "silver", "gold"]}]
    m = {r["metric"]: r["value"] for r in h["metrics"]}
    assert m["tag_assignments_governed_pct"] == 70.0 and m["tag_invalid_values"] == 2


def test_gov035_finding_and_inventory_invalid_count():
    pages = [{"tag_policies": [{"tag_key": "camada"}]}]
    rest, _ = _policy_rest(pages, {"camada": {"values": [{"name": "gold"}]}})
    usage = [{"tag_key": "camada", "assignments": 3, "distinct_values": 2, "securable_types": "table",
              "top_values_json": "[]"}]
    kv = [{"k": "camada", "v": "gold", "n": 1}, {"k": "camada", "v": "Ouro", "n": 2}]
    res = MetadataCollector(load_tag_profile(), "ws1", "s1", rest=rest).collect(
        _Spark([_fact("t")], usage=usage, kv=kv))
    f = next(f for f in res.findings if f.rule_id == "GOV-035")
    assert f.evidence["assignments"] == 2
    assert res.inventory["tag_inventory"][0]["invalid_assignments"] == 2


# -- Phase 2: protection gap ---------------------------------------------------------
def _col(c, s, t, col, **kw):
    return {"c": c, "s": s, "t": t, "col": col, **kw}


def test_protection_direct_mask_abac_and_gap():
    tagged = [_col("cat", "crm", "clients", "email", k="class.email_address", v=""),
              _col("cat", "crm", "clients", "phone", k="class.phone_number", v=""),
              _col("cat", "hr", "staff", "ssn", k="pii", v="true"),
              _col("cat", "hr", "staff", "dept", k="pii", v="false")]  # explicit "not sensitive"
    masks = [_col("cat", "crm", "clients", "email", mask_name="cat.crm.mask_email")]
    abac = [{"policy_name": "mask_phone", "c": "cat", "s": "crm", "t": None, "k": "class.phone_number", "v": None}]
    out = evaluate_protection(tagged, masks, abac, detections=None, candidates=[])
    by = {r["column"]: r for r in out["columns"]}
    assert by["email"]["protection"] == "direct_mask"
    assert by["phone"]["protection"] == "abac_policy" and by["phone"]["protected_by"] == "mask_phone"
    assert by["ssn"]["protection"] == "none" and "dept" not in by
    m = {r["metric"]: r["value"] for r in out["metrics"]}
    assert (m["protection_sensitive_columns"], m["protection_unprotected"]) == (3, 1)


def test_abac_scope_must_contain_the_table():
    tagged = [_col("cat", "hr", "staff", "ssn", k="pii", v="true")]
    abac = [{"policy_name": "other_schema", "c": "cat", "s": "crm", "t": None, "k": "pii", "v": None},
            {"policy_name": "wrong_value", "c": "cat", "s": None, "t": None, "k": "pii", "v": "high"}]
    out = evaluate_protection(tagged, [], abac, detections=None, candidates=[])
    assert out["columns"][0]["protection"] == "none"


def test_name_heuristic_is_separate_and_masked_candidates_drop():
    cands = [_col("cat", "crm", "leads", "email", hint="email"), _col("cat", "crm", "leads", "phone", hint="phone")]
    masks = [_col("cat", "crm", "leads", "phone", mask_name="m")]
    out = evaluate_protection([], masks, [], detections=None, candidates=cands)
    assert [(r["column"], r["source"]) for r in out["columns"]] == [("email", "name_heuristic")]


class _ProtSpark:
    def __init__(self, tagged=(), masks=(), abac=None, detections=None, cands=()):
        self.r = {"column_tags": list(tagged), "column_masks": list(masks), "abac": abac,
                  "data_classification": detections, "RLIKE": list(cands)}

    def sql(self, q):
        if "abac_policy_definitions" in q:
            if self.r["abac"] is None:
                raise RuntimeError("PERMISSION_DENIED")
            return _DF(self.r["abac"])
        if "data_classification.results" in q:
            if self.r["data_classification"] is None:
                raise RuntimeError("INSUFFICIENT_PERMISSIONS")
            return _DF(self.r["data_classification"])
        for key in ("column_tags", "column_masks", "RLIKE"):
            if key in q:
                return _DF(self.r[key])
        return _DF([])


def test_protection_collector_findings_and_never_selects_samples():
    spark = _ProtSpark(tagged=[_col("cat", "hr", "staff", "ssn", k="pii", v="true")], abac=[],
                       detections=[_col("cat", "crm", "c", "email", k="class.email_address", confidence="HIGH")],
                       cands=[_col("cat", "crm", "leads", "cpf", hint="cpf")])
    queries = []
    orig = spark.sql
    spark.sql = lambda q: (queries.append(q), orig(q))[1]
    res = ProtectionCollector(load_tag_profile(), "ws1", "s1").collect(spark)
    by = {f.rule_id: f for f in res.findings}
    assert by["SEC-040"].evidence["unprotected"] == 2  # tagged ssn + detected email
    assert by["SEC-041"].evidence["untagged"] == 1
    assert by["SEC-042"].evidence["candidates"] == 1
    assert "GOV-036" not in by  # no REST → classification config unknown, never guessed
    # the `samples` column (real values) is never selected; 'samples' the catalog only appears in filters
    dc = [q for q in queries if "data_classification.results" in q]
    assert dc and all("samples" not in q.split("FROM")[0] for q in dc)


def test_gov036_from_classification_config():
    def rest(method, path, body=None):
        if "unity-catalog/catalogs" in path:
            return {"catalogs": [{"name": "sales", "catalog_type": "MANAGED_CATALOG"},
                                 {"name": "share", "catalog_type": "DELTASHARING_CATALOG"},
                                 {"name": "hr", "catalog_type": "MANAGED_CATALOG"}]}
        if "/catalogs/hr/" in path:
            return {"name": "catalogs/hr/config"}
        raise RuntimeError("Data Classification config not found")
    res = ProtectionCollector(load_tag_profile(), "ws1", "s1", rest=rest).collect(_ProtSpark(abac=[]))
    f = next(f for f in res.findings if f.rule_id == "GOV-036")
    assert f.evidence["sample"] == ["sales"] and f.evidence["managed_catalogs"] == 2



# -- Phase 3: Metadata Readiness + LLM review ---------------------------------------
from compass_core.collectors.metadata import review_finding  # noqa: E402
from compass_core.metadata_readiness import WEIGHTS, readiness_index, readiness_metrics, table_scores  # noqa: E402


def _t(n, readers=0, **kw):
    f = _fact(n, **kw)
    f["readers"] = readers
    return f


def test_readiness_components_and_usage_weighting():
    p = load_tag_profile()
    perfect = _t("gold", readers=40, table_q="useful", domain="Sales", layer="gold", owner="ana", cert="certified", useful=10)
    bare = _t("staging", readers=0, table_q="missing", useful=0, missing=10)
    rows = {r["table"]: r for r in table_scores(p, [perfect, bare], [], [])}
    assert rows["gold"]["score"] == sum(WEIGHTS.values())  # 1.0
    # no sensitive columns → sensitivity is resolved by default; nothing else earned
    assert round(rows["staging"]["score"], 2) == WEIGHTS["sensitivity"]
    idx = readiness_index(list(rows.values()))
    assert idx["index"] > idx["unweighted"]  # the widely read table dominates


def test_readiness_sensitivity_and_llm_credit():
    p = load_tag_profile()
    f = _t("crm", table_q="useful", useful=4)
    sens = [{"catalog": "cat", "schema": "sch", "table": "crm", "source": "tag", "protection": "direct_mask"},
            {"catalog": "cat", "schema": "sch", "table": "crm", "source": "name_heuristic", "protection": "none"}]
    reviews = [{"catalog": "cat", "schema": "sch", "table": "crm", "verdict": v} for v in ("poor", "poor", "weak", "good")]
    r = table_scores(p, [f], sens, reviews)[0]
    assert r["sensitivity"] == 0.5
    # 4 documented columns, all reviewed: credit 0+0+0.5+1 = 1.5 of 4 → col doc 0.375
    assert round(r["documentation"], 4) == round(0.5 + 0.5 * 0.375, 4)


def test_readiness_metrics_shape_by_domain():
    p = load_tag_profile()
    metrics, domains = readiness_metrics(p, [_t("a", domain="Sales"), _t("b")], [], [])
    names = {m["metric"] for m in metrics}
    assert {"metadata_readiness", "metadata_readiness_unweighted", "mr_documentation", "mr_curation"} <= names
    assert [d["domain"] for d in domains] == ["Sales", ""]  # untagged bucket last


def test_review_finding_threshold_and_severity():
    good = [{"verdict": "good"}] * 8
    assert review_finding(good + [{"verdict": "weak"}], "s", "ws") is None  # 11% < 20%
    f = review_finding(good[:3] + [{"verdict": "poor", "reason": "restates name"}] * 3, "s", "ws")
    assert f.rule_id == "GOV-041" and f.evidence["pct"] == 50.0 and f.severity.value == "medium"
    assert review_finding([], "s", "ws") is None


def test_candidate_priority_prefers_curated_and_read_tables():
    mc = MetadataCollector(load_tag_profile(), "ws1", "s1")
    gold = _t("g", layer="gold", cert="certified")
    few = _t("r", readers=3)
    many = _t("m", readers=20)
    plain = _t("p")
    assert mc.priority(gold) > mc.priority(few) > mc.priority(plain) == 0
    assert mc.priority(many) > mc.priority(gold)  # a table 20 people read outranks an unread gold one


def test_gov041_rule_registered_and_mapped():
    reg = RuleRegistry()
    assert reg.get("GOV-041").domain == "governance"
    assert "GOV-041" in {c.rule for c in load_controls()}
