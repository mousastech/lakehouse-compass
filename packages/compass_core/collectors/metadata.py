"""Metadata collector — tag-based monitoring + description quality (Phase 1).

Reads Unity Catalog `system.information_schema` (tables, columns, *_tags) and,
on the local workspace, the account's governed-tag policies (Tag Policy API):

  * **Description quality (N1)** — every table/column comment is classified by
    deterministic SQL heuristics into missing / placeholder / echo (repeats the
    name) / generic / short / boilerplate (same text on ≥3 different names) /
    useful. "Documented" stops meaning "has any text".
  * **Effective tags** — catalog → schema → table inheritance (most specific
    wins), resolved to semantic roles through the Tag Profile, so a deployment's
    own keys (`dominio_negocio`, `camada`, `certificado`…) count.
  * **Scorecard by role value** (`tag_rollup`) — per domain / layer / owner:
    tables, useful descriptions, certified, owned, deprecated.
  * **Tag inventory** (`tag_inventory`) — every key in use, its mapped role (or a
    suggested one), whether it is governed, and its top values.

Findings: GOV-016 (governed tags never applied), GOV-030 (gold without owner),
GOV-031 (gold not certified), GOV-033 (domain without an owner), GOV-040
(generic descriptions on the assets that matter). Read-only; never reads data
rows, only metadata.
"""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any, Callable, Optional

from ..models.capability import Availability
from ..models.finding import Finding, Severity
from ..tag_profile import TagProfile, sql_in, sql_str
from .base import CollectorResult, SparkLike, cap, rows_as_dicts

_INTERNAL_CATALOGS = ("system", "__databricks_internal", "samples", "hive_metastore")
# Governed tags Databricks defines itself; they are not the customer's taxonomy.
_SYSTEM_TAG_PREFIXES = ("system.", "class.", "ai.", "sap.")

QUALITY_CLASSES = ("useful", "missing", "placeholder", "echo", "generic", "short", "boilerplate")
SHORT_MAX_LEN = 10          # comments shorter than this cannot explain anything
BOILERPLATE_MIN_NAMES = 3   # identical text reused on ≥ N different names
_SAMPLE = 10

# Full-match patterns (lower-cased, trimmed). Bracket classes instead of
# backslash escapes so they survive Spark SQL string-literal unescaping.
_PLACEHOLDER_RE = (
    "^(tbd|tba|todo|fixme|n/?a|none|null|nil|test|teste|prueba|x+|lorem.*|[-]+|[.]+|[?]+"
    "|comments?|coment[aá]rios?|sem descri[cç][aã]o|sin descripci[oó]n|no description)[.]?$"
)
_GENERIC_RE = (
    "^((the|a|an) )?((unique|primary|foreign) )?"
    "(id|identifier|key|name|value|values|date|time|timestamp|column|field|code|number|num|flag|type"
    "|status|amount|count|description|desc|data|info|information|text|string|integer|int|bigint"
    "|double|decimal|boolean|bool|coluna|campo|valor|nome|nombre|codigo|código|fecha|tipo"
    "|descri[cç][aã]o|descripci[oó]n)"
    "( (of|for|in|da|do|de|del) (the |this |a |la |el )?"
    "(column|field|record|row|table|entity|object|data|coluna|campo|tabela|tabla|registro))?[.]?$"
)
_ARTICLE_RE = "^(the|a|an|o|os|as|el|la|los|las) "


def _norm_sql(expr: str) -> str:
    return f"regexp_replace(regexp_replace(lower({expr}), '{_ARTICLE_RE}', ''), '[^a-z0-9]', '')"


def quality_case_sql(text: str, name: str, bp_flag: str) -> str:
    """SQL CASE classifying a comment. `bp_flag` is a boolean expression that is
    true when the text is reused verbatim on ≥ BOILERPLATE_MIN_NAMES names."""
    return (
        f"CASE WHEN {text} IS NULL OR {text} = '' THEN 'missing' "
        f"WHEN lower({text}) RLIKE '{_PLACEHOLDER_RE}' THEN 'placeholder' "
        f"WHEN {_norm_sql(text)} = {_norm_sql(name)} THEN 'echo' "
        f"WHEN lower({text}) RLIKE '{_GENERIC_RE}' THEN 'generic' "
        f"WHEN length({text}) < {SHORT_MAX_LEN} THEN 'short' "
        f"WHEN {bp_flag} THEN 'boilerplate' "
        f"ELSE 'useful' END"
    )


def internal_filter(col: str) -> str:
    return (f" AND {col} NOT IN ({', '.join(sql_str(c) for c in _INTERNAL_CATALOGS)}) "
            f"AND {col} NOT RLIKE '^__' ")


def effective_roles_sql(profile: TagProfile, src: Callable[[str], str], tables_where: str) -> str:
    """Per-table effective role values (one row per table).

    `src(view)` returns a FROM-able information_schema source. Tags on a catalog or
    schema apply to every table under it (except roles in `inherit_exclude`);
    for each (table, role) the most specific assignment wins (table > schema > catalog)."""
    role = profile.role_case_sql("k")
    no_inherit = (f" AND (tr.lvl = 3 OR tr.role NOT IN ({sql_in(profile.inherit_exclude)}))"
                  if profile.inherit_exclude else "")
    return f"""
    WITH t AS (
      SELECT table_catalog AS c, table_schema AS s, table_name AS n
      FROM {src('tables')} WHERE {tables_where}
    ),
    tg AS (
      SELECT catalog_name AS c, schema_name AS s, table_name AS n, tag_name AS k, tag_value AS v, 3 AS lvl
      FROM {src('table_tags')}
      UNION ALL
      SELECT catalog_name, schema_name, CAST(NULL AS STRING), tag_name, tag_value, 2 FROM {src('schema_tags')}
      UNION ALL
      SELECT catalog_name, CAST(NULL AS STRING), CAST(NULL AS STRING), tag_name, tag_value, 1
      FROM {src('catalog_tags')}
    ),
    tr AS (SELECT c, s, n, {role} AS role, v, lvl FROM tg),
    eff AS (
      SELECT t.c, t.s, t.n, tr.role, tr.v,
             ROW_NUMBER() OVER (PARTITION BY t.c, t.s, t.n, tr.role ORDER BY tr.lvl DESC, tr.v) AS rk
      FROM t JOIN tr ON tr.role IS NOT NULL AND tr.c = t.c
        AND (tr.s IS NULL OR tr.s = t.s) AND (tr.n IS NULL OR tr.n = t.n){no_inherit}
    )
    SELECT t.c, t.s, t.n,
           MAX(CASE WHEN eff.role = 'domain' THEN eff.v END) AS domain,
           MAX(CASE WHEN eff.role = 'layer' THEN lower(eff.v) END) AS layer,
           MAX(CASE WHEN eff.role = 'owner' THEN eff.v END) AS owner,
           MAX(CASE WHEN eff.role = 'certification' THEN lower(eff.v) END) AS cert,
           MAX(CASE WHEN eff.role = 'sensitivity' THEN 1 ELSE 0 END) AS sensitive
    FROM t LEFT JOIN eff ON eff.c = t.c AND eff.s = t.s AND eff.n = t.n AND eff.rk = 1
    GROUP BY t.c, t.s, t.n
    """


def _system_src(view: str) -> str:
    return f"system.information_schema.{view}"


class MetadataCollector:
    domain = "governance"

    def __init__(self, profile: TagProfile, workspace_id: str, scan_id: str = "live", workspace_name: str = "",
                 rest: Optional[Callable[..., dict]] = None):
        self.profile = profile
        self.workspace_id = workspace_id
        self.workspace_name = workspace_name
        self.scan_id = scan_id
        self.rest = rest

    # -- queries ----------------------------------------------------------------
    def _table_facts(self, spark: SparkLike) -> list[dict[str, Any]]:
        where = "table_schema <> 'information_schema'" + internal_filter("table_catalog")
        roles = effective_roles_sql(self.profile, _system_src, where)
        col_q = quality_case_sql("x", "nm", "bp.lx IS NOT NULL")
        tbl_q = quality_case_sql("tbl.x", "tbl.n", "tbp.lx IS NOT NULL")
        cols = "\n".join(f"SUM(CASE WHEN q = '{q}' THEN 1 ELSE 0 END) AS col_{q}," for q in QUALITY_CLASSES)
        sql = f"""
        WITH roles AS ({roles}),
        cols AS (
          SELECT table_catalog AS c, table_schema AS s, table_name AS n, column_name AS nm, trim(comment) AS x
          FROM system.information_schema.columns WHERE {where}
        ),
        bp AS (
          SELECT lower(x) AS lx FROM cols WHERE x <> '' GROUP BY lower(x)
          HAVING COUNT(DISTINCT lower(nm)) >= {BOILERPLATE_MIN_NAMES}
        ),
        cq AS (SELECT cols.c, cols.s, cols.n, {col_q} AS q FROM cols LEFT JOIN bp ON bp.lx = lower(cols.x)),
        cagg AS (SELECT c, s, n, {cols} COUNT(*) AS col_total FROM cq GROUP BY c, s, n),
        tbl AS (
          SELECT table_catalog AS c, table_schema AS s, table_name AS n, trim(comment) AS x
          FROM system.information_schema.tables WHERE {where}
        ),
        tbp AS (
          SELECT lower(x) AS lx FROM tbl WHERE x <> '' GROUP BY lower(x)
          HAVING COUNT(DISTINCT lower(n)) >= {BOILERPLATE_MIN_NAMES}
        )
        SELECT tbl.c, tbl.s, tbl.n, {tbl_q} AS table_q,
               r.domain, r.layer, r.owner, r.cert, r.sensitive,
               {', '.join(f'COALESCE(cagg.col_{q}, 0) AS col_{q}' for q in QUALITY_CLASSES)},
               COALESCE(cagg.col_total, 0) AS col_total
        FROM tbl
        LEFT JOIN tbp ON tbp.lx = lower(tbl.x)
        LEFT JOIN roles r ON r.c = tbl.c AND r.s = tbl.s AND r.n = tbl.n
        LEFT JOIN cagg ON cagg.c = tbl.c AND cagg.s = tbl.s AND cagg.n = tbl.n
        """
        return rows_as_dicts(spark, sql)

    def _weak_examples(self, spark: SparkLike) -> list[dict[str, Any]]:
        """Most frequent non-useful column comments (metadata text, never data)."""
        where = "table_schema <> 'information_schema'" + internal_filter("table_catalog")
        q = quality_case_sql("x", "nm", "bp.lx IS NOT NULL")
        sql = f"""
        WITH cols AS (
          SELECT column_name AS nm, trim(comment) AS x FROM system.information_schema.columns WHERE {where}
        ),
        bp AS (
          SELECT lower(x) AS lx FROM cols WHERE x <> '' GROUP BY lower(x)
          HAVING COUNT(DISTINCT lower(nm)) >= {BOILERPLATE_MIN_NAMES}
        ),
        cq AS (SELECT cols.x, cols.nm, {q} AS q FROM cols LEFT JOIN bp ON bp.lx = lower(cols.x))
        SELECT q, x AS text, COUNT(*) AS n, COUNT(DISTINCT lower(nm)) AS names
        FROM cq WHERE q NOT IN ('useful', 'missing')
        GROUP BY q, x ORDER BY n DESC LIMIT 12
        """
        return rows_as_dicts(spark, sql)

    def _tag_usage(self, spark: SparkLike) -> list[dict[str, Any]]:
        parts = []
        for view, typ in (("catalog_tags", "catalog"), ("schema_tags", "schema"),
                          ("table_tags", "table"), ("column_tags", "column"), ("volume_tags", "volume")):
            parts.append(f"SELECT tag_name AS k, tag_value AS v, '{typ}' AS typ FROM system.information_schema.{view} "
                         f"WHERE 1=1{internal_filter('catalog_name')}")
        sql = f"""
        WITH a AS ({' UNION ALL '.join(parts)}),
        vc AS (SELECT k, v, COUNT(*) AS n FROM a GROUP BY k, v),
        top AS (
          SELECT k, collect_list(named_struct('v', v, 'n', n)) AS vals
          FROM (SELECT k, v, n, ROW_NUMBER() OVER (PARTITION BY k ORDER BY n DESC, v) AS rk FROM vc)
          WHERE rk <= 5 GROUP BY k
        )
        SELECT a.k AS tag_key, COUNT(*) AS assignments, COUNT(DISTINCT a.v) AS distinct_values,
               array_join(array_sort(collect_set(a.typ)), ',') AS securable_types,
               to_json(FIRST(top.vals)) AS top_values_json
        FROM a LEFT JOIN top ON top.k = a.k GROUP BY a.k
        """
        return rows_as_dicts(spark, sql)

    def _governed_keys(self) -> Optional[set[str]]:
        """Governed tag keys of the account (Tag Policy API). None = not readable."""
        if self.rest is None:
            return None
        keys: set[str] = set()
        token = ""
        for _ in range(50):  # bounded pagination
            path = "/api/2.1/tag-policies?page_size=1000" + (f"&page_token={token}" if token else "")
            resp = self.rest("GET", path) or {}
            for p in resp.get("tag_policies") or []:
                if p.get("tag_key"):
                    keys.add(str(p["tag_key"]).lower())
            token = resp.get("next_page_token") or ""
            if not token:
                break
        return keys

    # -- orchestration ------------------------------------------------------------
    def collect(self, spark: SparkLike) -> CollectorResult:
        res = CollectorResult()
        try:
            facts = self._table_facts(spark)
            res.capabilities.append(cap("tags", "system.information_schema", Availability.AVAILABLE))
        except Exception as e:
            res.capabilities.append(cap("tags", "system.information_schema", Availability.NOT_AVAILABLE, str(e)[:300]))
            return res

        try:
            examples = self._weak_examples(spark)
        except Exception as e:  # examples are illustrative; never block the scan
            print(f"[compass] metadata examples failed: {str(e)[:160]}")
            examples = []
        try:
            usage = self._tag_usage(spark)
        except Exception as e:
            print(f"[compass] tag usage failed: {str(e)[:160]}")
            usage = []

        governed: Optional[set[str]] = None
        try:
            governed = self._governed_keys()
            if governed is not None:
                res.capabilities.append(cap("tag_policies", "tag_policies_api", Availability.AVAILABLE))
        except Exception as e:
            res.capabilities.append(cap("tag_policies", "tag_policies_api", Availability.NOT_AVAILABLE, str(e)[:300]))
        if governed is None and not any(c.id == "tag_policies" for c in res.capabilities):
            res.capabilities.append(cap("tag_policies", "tag_policies_api", Availability.NOT_AVAILABLE,
                                        "Tag Policy API is read from the local workspace only."))

        res.inventory["governance_metrics"] = self._quality_metrics(facts, examples)
        res.inventory["tag_rollup"] = self._rollup(facts)
        res.inventory["tag_inventory"] = self._inventory(usage, governed)
        res.findings += self._findings(facts, usage, governed)
        return res

    # -- shaping ----------------------------------------------------------------
    def _row(self, **kw: Any) -> dict[str, Any]:
        return {"scan_id": self.scan_id, "workspace_id": self.workspace_id,
                "workspace_name": self.workspace_name, **kw}

    def _quality_metrics(self, facts: list[dict], examples: list[dict]) -> list[dict]:
        col = {q: sum(int(f.get(f"col_{q}") or 0) for f in facts) for q in QUALITY_CLASSES}
        col_total = sum(int(f.get("col_total") or 0) for f in facts)
        tbl = {q: sum(1 for f in facts if f.get("table_q") == q) for q in QUALITY_CLASSES}
        tbl_total = len(facts)

        def pct(n: int, d: int) -> float:
            return round(100.0 * n / d, 1) if d else 0.0

        rows = []
        for scope, counts, total in (("column", col, col_total), ("table", tbl, tbl_total)):
            documented = total - counts["missing"]
            rows.append({"metric": f"{scope}_total", "value": float(total), "detail": "all user catalogs"})
            rows.append({"metric": f"{scope}_documented_pct", "value": pct(documented, total), "detail": ""})
            rows.append({"metric": f"{scope}_useful_pct", "value": pct(counts["useful"], total), "detail": ""})
            for q in QUALITY_CLASSES:
                rows.append({"metric": f"{scope}_q_{q}", "value": float(counts[q]), "detail": ""})
        rows.append({"metric": "weak_comment_examples", "value": float(len(examples)),
                     "detail": json.dumps([{"class": e.get("q"), "text": e.get("text"), "n": int(e.get("n") or 0),
                                            "names": int(e.get("names") or 0)} for e in examples], default=str)})
        return [{"scan_id": self.scan_id, "workspace_id": self.workspace_id, **r} for r in rows]

    def _is_gold(self, f: dict) -> bool:
        return bool(f.get("layer")) and str(f["layer"]).lower() in self.profile.gold_values

    def _rollup(self, facts: list[dict]) -> list[dict]:
        p = self.profile
        acc: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for f in facts:
            cert = str(f.get("cert") or "").lower()
            for role in ("domain", "layer", "owner"):
                val = f.get(role)
                a = acc[(role, str(val) if val else "")]
                a["tables"] += 1
                a["tables_useful"] += 1 if f.get("table_q") == "useful" else 0
                a["columns"] += int(f.get("col_total") or 0)
                a["columns_useful"] += int(f.get("col_useful") or 0)
                a["certified"] += 1 if cert in p.certified_values else 0
                a["deprecated"] += 1 if cert in p.deprecated_values else 0
                a["with_owner"] += 1 if f.get("owner") else 0
                a["gold"] += 1 if self._is_gold(f) else 0
                a["sensitive"] += int(f.get("sensitive") or 0)
        return [self._row(role=role, value=val, **{k: int(v) for k, v in a.items()})
                for (role, val), a in sorted(acc.items(), key=lambda kv: (kv[0][0], -kv[1]["tables"]))]

    def _inventory(self, usage: list[dict], governed: Optional[set[str]]) -> list[dict]:
        rows = []
        for u in usage:
            key = str(u.get("tag_key") or "")
            try:
                top = json.loads(u.get("top_values_json") or "[]") or []
            except ValueError:
                top = []
            values = [str(t.get("v")) for t in top if isinstance(t, dict) and t.get("v") is not None]
            rows.append(self._row(
                tag_key=key, role=self.profile.role_of(key) or "",
                suggested_role=self.profile.suggest_role(key, values) or "",
                governed=(key.lower() in governed) if governed is not None else None,
                securable_types=u.get("securable_types") or "",
                assignments=int(u.get("assignments") or 0), distinct_values=int(u.get("distinct_values") or 0),
                top_values_json=json.dumps(top, default=str)))
        rows.sort(key=lambda r: -r["assignments"])
        return rows

    def _finding(self, rule_id: str, title: str, severity: Severity, resource: str,
                 evidence: dict, remediation: str, controls: list[str]) -> Finding:
        return Finding(
            id=f"{self.scan_id}-{rule_id}-{self.workspace_id}", rule_id=rule_id, domain="governance",
            title=title, severity=severity, resource=resource, evidence=evidence, remediation=remediation,
            framework_controls=controls, scan_id=self.scan_id, workspace_id=self.workspace_id,
            workspace_name=self.workspace_name)

    def _findings(self, facts: list[dict], usage: list[dict], governed: Optional[set[str]]) -> list[Finding]:
        out: list[Finding] = []
        p = self.profile
        fqn = lambda f: f"{f.get('c')}.{f.get('s')}.{f.get('n')}"  # noqa: E731
        gold = [f for f in facts if self._is_gold(f)]

        # GOV-016 — customer governed tags (not Databricks system tags) never applied.
        if governed is not None:
            custom = {k for k in governed if not k.startswith(_SYSTEM_TAG_PREFIXES)}
            used = {str(u.get("tag_key") or "").lower() for u in usage}
            unused = sorted(custom - used)
            if custom and unused:
                share = round(100.0 * len(unused) / len(custom), 1)
                out.append(self._finding(
                    "GOV-016", "Governed tags defined but never applied",
                    Severity.MEDIUM if share >= 50 else Severity.LOW,
                    f"account tag policies · {len(unused)} of {len(custom)} unused",
                    {"governed_custom_keys": len(custom), "unused": len(unused), "unused_pct": share,
                     "used_in_metastore": len(custom) - len(unused), "sample_unused": unused[:15],
                     "note": "Governed tags are account-level; usage is measured on the catalogs this scan can read."},
                    "Apply the governed tags to the objects they classify, or retire unused tag policies.",
                    ["DBX-SBP:GOV-1"]))

        if gold:
            no_owner = [f for f in gold if not f.get("owner")]
            if no_owner:
                share = round(100.0 * len(no_owner) / len(gold), 1)
                out.append(self._finding(
                    "GOV-030", "Gold tables without an owner/steward tag",
                    Severity.MEDIUM if share >= 50 else Severity.LOW,
                    f"{len(no_owner)} of {len(gold)} gold tables",
                    {"gold_tables": len(gold), "without_owner": len(no_owner), "pct": share,
                     "owner_keys": p.keys.get("owner", []), "sample": [fqn(f) for f in no_owner[:_SAMPLE]]},
                    "Tag each gold table (or its schema) with the accountable owner/steward.",
                    ["DBX-SBP:GOV-2"]))
            uncert = [f for f in gold if str(f.get("cert") or "").lower() not in p.certified_values]
            if uncert:
                out.append(self._finding(
                    "GOV-031", "Gold tables not certified",
                    Severity.LOW, f"{len(uncert)} of {len(gold)} gold tables",
                    {"gold_tables": len(gold), "uncertified": len(uncert),
                     "certification_keys": p.keys.get("certification", []),
                     "sample": [fqn(f) for f in uncert[:_SAMPLE]]},
                    "Certify canonical gold tables (system.certification_status = certified) so users and Genie "
                    "know which to trust.",
                    ["DBX-SBP:GOV-2"]))

        by_domain: dict[str, list[dict]] = defaultdict(list)
        for f in facts:
            if f.get("domain"):
                by_domain[str(f["domain"])].append(f)
        orphan = sorted(d for d, fs in by_domain.items() if not any(x.get("owner") for x in fs))
        if orphan:
            out.append(self._finding(
                "GOV-033", "Domains without a named owner/steward",
                Severity.LOW, f"{len(orphan)} of {len(by_domain)} domains",
                {"domains": len(by_domain), "without_owner": len(orphan), "sample": orphan[:_SAMPLE]},
                "Assign an owner/steward tag to at least the schemas of each domain.",
                ["DBX-SBP:GOV-2"]))

        # GOV-040 — weak descriptions where they matter: gold if tagged, else all tables.
        scope = gold or facts
        if scope:
            cols = sum(int(f.get("col_total") or 0) for f in scope)
            useful = sum(int(f.get("col_useful") or 0) for f in scope)
            documented = cols - sum(int(f.get("col_missing") or 0) for f in scope)
            weak = documented - useful
            useful_pct = round(100.0 * useful / cols, 1) if cols else 0.0
            if documented and weak / documented >= 0.1:
                out.append(self._finding(
                    "GOV-040", "Generic or empty-of-meaning descriptions",
                    Severity.MEDIUM if gold else Severity.LOW,
                    f"{'gold' if gold else 'all'} tables · {weak} of {documented} column comments are weak",
                    {"scope": "gold" if gold else "all_tables", "tables": len(scope), "columns": cols,
                     "documented": documented, "useful": useful, "weak": weak, "useful_pct": useful_pct,
                     "classes": {q: sum(int(f.get(f"col_{q}") or 0) for f in scope)
                                 for q in QUALITY_CLASSES if q not in ("useful", "missing")}},
                    "Rewrite comments that repeat the column name or use boilerplate: state meaning, unit, grain "
                    "and business rule.",
                    ["DBX-SBP:GOV-2"]))
        return out
