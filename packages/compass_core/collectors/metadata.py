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

  * **Tag hygiene** — key variants that collide (`Camada`/`camada`), roles
    spread over several keys, value case variants, and governed keys used with
    values outside their tag policy's allowed list.

Findings: GOV-016 (governed tags never applied), GOV-030 (gold without owner),
GOV-031 (gold not certified), GOV-033 (domain without an owner), GOV-034 (tag
drift), GOV-035 (values outside the allowed list), GOV-040 (generic
descriptions on the assets that matter). Read-only; never reads data rows, only
metadata.
"""

from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from typing import Any, Callable, Optional
from urllib.parse import quote

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
_MAX_POLICY_LOOKUPS = 200   # allowed-values lookups (one GET per governed key in use)
_MAX_TAG_VALUES = 20000     # distinct (key, value) pairs read for hygiene checks
_CANDIDATE_TABLES = 40      # priority tables exported for the in-app LLM review
_CANDIDATE_COLUMNS = 1500   # cap on exported column comments per scan

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

    def _table_reads(self, spark: SparkLike) -> dict[str, dict[str, int]]:
        """Reads and distinct readers per table in the last 30 days, from this
        workspace's lineage (the metastore is shared across workspaces)."""
        ws = f" AND CAST(workspace_id AS STRING) = {sql_str(self.workspace_id)}" if self.workspace_id else ""
        rows = rows_as_dicts(spark, f"""
            SELECT source_table_full_name AS fq, COUNT(*) AS reads, COUNT(DISTINCT created_by) AS readers
            FROM system.access.table_lineage
            WHERE event_date >= current_date() - INTERVAL 30 DAYS AND source_table_full_name IS NOT NULL{ws}
            GROUP BY source_table_full_name""")
        return {str(r["fq"]): {"reads": int(r.get("reads") or 0), "readers": int(r.get("readers") or 0)} for r in rows}

    def priority(self, f: dict[str, Any]) -> float:
        """Review priority of a table: curated, certified and widely read first."""
        cert = str(f.get("cert") or "").lower() in self.profile.certified_values
        return round(3.0 * self._is_gold(f) + 2.0 * cert + 2.0 * math.log1p(int(f.get("readers") or 0))
                     + 0.5 * math.log1p(int(f.get("reads") or 0)), 3)

    def _candidates(self, spark: SparkLike, facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Commented columns of the top-priority tables, for the in-app LLM review.
        Metadata text only (names, types, comments) — never data values."""
        ranked = sorted((f for f in facts if int(f.get("col_total") or 0) > int(f.get("col_missing") or 0)),
                        key=lambda f: -self.priority(f))[:_CANDIDATE_TABLES]
        if not ranked:
            return []
        prio = {(f["c"], f["s"], f["n"]): self.priority(f) for f in ranked}
        keys = ", ".join(f"({sql_str(c)}, {sql_str(sc)}, {sql_str(n)})" for c, sc, n in prio)
        q = quality_case_sql("trim(col.comment)", "col.column_name", "false")
        rows = rows_as_dicts(spark, f"""
            SELECT col.table_catalog AS c, col.table_schema AS s, col.table_name AS t, col.column_name AS col,
                   col.data_type, trim(col.comment) AS comment, trim(tb.comment) AS table_comment, {q} AS heuristic,
                   sha2(concat_ws('|', col.table_catalog, col.table_schema, col.table_name, col.column_name,
                                  trim(col.comment)), 256) AS comment_hash
            FROM {_system_src('columns')} col
            JOIN {_system_src('tables')} tb ON tb.table_catalog = col.table_catalog
              AND tb.table_schema = col.table_schema AND tb.table_name = col.table_name
            WHERE (col.table_catalog, col.table_schema, col.table_name) IN ({keys})
              AND col.comment IS NOT NULL AND trim(col.comment) <> ''
            ORDER BY col.table_catalog, col.table_schema, col.table_name, col.ordinal_position""")
        out = []
        for r in rows:
            out.append(self._row(catalog=r["c"], schema=r["s"], table=r["t"], column=r["col"],
                                 data_type=r.get("data_type"), comment=r.get("comment"),
                                 table_comment=r.get("table_comment"), heuristic=r.get("heuristic"),
                                 comment_hash=r.get("comment_hash"), priority=float(prio[(r["c"], r["s"], r["t"])])))
        out.sort(key=lambda r: -r["priority"])
        return out[:_CANDIDATE_COLUMNS]

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

    def _tag_values(self, spark: SparkLike) -> list[dict[str, Any]]:
        """Distinct (key, value) assignments with counts — input for the hygiene checks."""
        parts = [f"SELECT tag_name AS k, tag_value AS v FROM {_system_src(view)} WHERE 1=1{internal_filter('catalog_name')}"
                 for view in ("catalog_tags", "schema_tags", "table_tags", "column_tags", "volume_tags")]
        return rows_as_dicts(
            spark, f"SELECT k, v, COUNT(*) AS n FROM ({' UNION ALL '.join(parts)}) GROUP BY k, v "
                   f"ORDER BY n DESC LIMIT {_MAX_TAG_VALUES}")

    def _governed_keys(self) -> Optional[set[str]]:
        """Governed tag keys of the account, as written (Tag Policy API). None = not readable."""
        if self.rest is None:
            return None
        keys: set[str] = set()
        token = ""
        for _ in range(50):  # bounded pagination
            path = "/api/2.1/tag-policies?page_size=1000" + (f"&page_token={token}" if token else "")
            resp = self.rest("GET", path) or {}
            for p in resp.get("tag_policies") or []:
                if p.get("tag_key"):
                    keys.add(str(p["tag_key"]))
            token = resp.get("next_page_token") or ""
            if not token:
                break
        return keys

    def _allowed_values(self, keys: list[str]) -> dict[str, list[str]]:
        """Allowed values per governed key (the list API omits them). An empty list
        means the policy accepts any value. Keys that fail to resolve are skipped."""
        out: dict[str, list[str]] = {}
        if self.rest is None:
            return out
        for k in keys[:_MAX_POLICY_LOOKUPS]:
            try:
                resp = self.rest("GET", f"/api/2.1/tag-policies/{quote(k, safe='')}") or {}
            except Exception:
                continue
            out[k] = [str(v.get("name")) for v in (resp.get("values") or []) if v.get("name") is not None]
        return out

    # -- orchestration ------------------------------------------------------------
    def collect(self, spark: SparkLike) -> CollectorResult:
        res = CollectorResult()
        try:
            facts = self._table_facts(spark)
            try:
                reads = self._table_reads(spark)
            except Exception as e:  # lineage is optional: priority falls back to curation only
                print(f"[compass] table lineage failed: {str(e)[:160]}")
                reads = {}
            for f in facts:
                u = reads.get(f"{f.get('c')}.{f.get('s')}.{f.get('n')}", {})
                f["reads"], f["readers"] = u.get("reads", 0), u.get("readers", 0)
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

        try:
            kv = self._tag_values(spark)
        except Exception as e:
            print(f"[compass] tag values failed: {str(e)[:160]}")
            kv = []
        used_keys = sorted({str(u.get("tag_key") or "") for u in usage} - {""})
        allowed = self._allowed_values([k for k in used_keys if k in governed]) if governed else {}

        hygiene = tag_hygiene(self.profile, kv, governed, allowed)
        res.inventory["governance_metrics"] = self._quality_metrics(facts, examples) + [
            {"scan_id": self.scan_id, "workspace_id": self.workspace_id, **r} for r in hygiene["metrics"]]
        res.inventory["tag_rollup"] = self._rollup(facts)
        try:
            res.inventory["metadata_candidates"] = self._candidates(spark, facts)
        except Exception as e:
            print(f"[compass] metadata candidates failed: {str(e)[:160]}")
        # Per-table facts feed the Metadata Readiness index (computed after the
        # protection collector in the scan job); kept in memory, not persisted.
        res.inventory["_table_facts"] = facts
        res.inventory["tag_inventory"] = self._inventory(usage, governed, allowed, hygiene["invalid_by_key"])
        res.findings += self._findings(facts, usage, governed)
        res.findings += self._hygiene_findings(hygiene)
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

    def _inventory(self, usage: list[dict], governed: Optional[set[str]],
                   allowed: dict[str, list[str]] | None = None,
                   invalid_by_key: dict[str, int] | None = None) -> list[dict]:
        allowed = allowed or {}
        invalid_by_key = invalid_by_key or {}
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
                governed=(key in governed) if governed is not None else None,
                allowed_values_json=json.dumps(allowed[key]) if key in allowed else None,
                invalid_assignments=int(invalid_by_key.get(key, 0)),
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
            custom = {k for k in governed if not k.lower().startswith(_SYSTEM_TAG_PREFIXES)}
            used = {str(u.get("tag_key") or "") for u in usage}
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

    def _hygiene_findings(self, h: dict[str, Any]) -> list[Finding]:
        out: list[Finding] = []
        drift = h["drift"]
        n_drift = len(drift["key_variants"]) + len(drift["roles_multi_key"]) + len(drift["value_variants"])
        if n_drift:
            out.append(self._finding(
                "GOV-034", "Tag drift: the same concept is tagged several ways", Severity.LOW,
                f"{n_drift} drift group(s)",
                {**drift, "note": "Key variants differ only by case or separators; a role spread over several keys "
                                  "is usually one concept that should be one governed key."},
                "Pick one governed key per concept (and one spelling per value), migrate the variants, and map "
                "the survivor in the Tag Profile.",
                ["DBX-SBP:GOV-1"]))
        inv = h["invalid"]
        if inv:
            total = sum(i["assignments"] for i in inv)
            out.append(self._finding(
                "GOV-035", "Governed tags used with values outside their allowed list", Severity.MEDIUM,
                f"{total} assignment(s) on {len(inv)} governed key(s)",
                {"keys": inv[:_SAMPLE], "assignments": total,
                 "note": "Usually assignments made before the tag policy existed; they now carry a governed key "
                         "with a value the policy rejects, so ABAC conditions on that value miss them."},
                "Re-tag these objects with an allowed value, or add the value to the tag policy if it is legitimate.",
                ["DBX-SBP:GOV-1"]))
        return out


def _norm_key(k: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(k).lower())


def tag_hygiene(profile: TagProfile, kv: list[dict[str, Any]], governed: Optional[set[str]],
                allowed: dict[str, list[str]]) -> dict[str, Any]:
    """Pure hygiene checks over distinct (key, value, n) assignments.

    * key_variants — keys in use that only differ by case/separators, or an
      ungoverned key that is a variant of a governed one;
    * roles_multi_key — a Tag Profile role carried by more than one key in use;
    * value_variants — values of one role that only differ by case;
    * invalid — governed keys whose assignments use values outside the policy's
      allowed list (keys whose policy has no values accept anything).
    Databricks system tags (class.*, system.*, ai.*, sap.*) are left out.
    """
    rows = [r for r in kv if r.get("k") and not str(r["k"]).lower().startswith(_SYSTEM_TAG_PREFIXES)]
    used = sorted({str(r["k"]) for r in rows})

    groups: dict[str, set[str]] = defaultdict(set)
    for k in used:
        groups[_norm_key(k)].add(k)
    # An UNGOVERNED key in use that is a variant of a governed key is drift too: policies
    # (and ABAC conditions) written against the governed spelling miss those objects.
    # Two governed spellings with only one in use is account noise, not drift here.
    gov_by_norm: dict[str, set[str]] = defaultdict(set)
    for g in governed or set():
        if not g.lower().startswith(_SYSTEM_TAG_PREFIXES):
            gov_by_norm[_norm_key(g)].add(g)
    key_variants = []
    for norm, ks in groups.items():
        ungoverned_used = {k for k in ks if not (governed and k in governed)}
        variants = set(ks)
        if ungoverned_used:
            variants |= gov_by_norm.get(norm, set())
        if len(variants) > 1:
            key_variants.append({"keys": sorted(variants), "in_use": sorted(ks),
                                 "governed": sorted(k for k in variants if governed and k in governed)})

    role_keys: dict[str, set[str]] = defaultdict(set)
    role_vals: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for r in rows:
        role = profile.role_of(r["k"])
        if not role:
            continue
        role_keys[role].add(str(r["k"]))
        if r.get("v") not in (None, ""):
            role_vals[role][str(r["v"]).strip().lower()].add(str(r["v"]))
    roles_multi_key = [{"role": role, "keys": sorted(ks)} for role, ks in sorted(role_keys.items()) if len(ks) > 1]
    value_variants = [{"role": role, "values": sorted(vs)}
                      for role, by in sorted(role_vals.items()) for vs in by.values() if len(vs) > 1]

    invalid: list[dict[str, Any]] = []
    invalid_by_key: dict[str, int] = {}
    for key, vals in allowed.items():
        if not vals:
            continue
        ok = set(vals)
        bad = [r for r in rows if r["k"] == key and str(r.get("v") or "") not in ok]
        if bad:
            n = sum(int(r.get("n") or 0) for r in bad)
            invalid_by_key[key] = n
            invalid.append({"key": key, "assignments": n, "values": sorted({str(r.get("v") or "") for r in bad})[:8],
                            "allowed": vals[:12]})
    invalid.sort(key=lambda i: -i["assignments"])

    total = sum(int(r.get("n") or 0) for r in rows)
    gov_n = sum(int(r.get("n") or 0) for r in rows if governed and r["k"] in governed)
    metrics = [
        {"metric": "tag_assignments_total", "value": float(total), "detail": "excluding Databricks system tags"},
        {"metric": "tag_assignments_governed_pct",
         "value": round(100.0 * gov_n / total, 1) if (total and governed is not None) else 0.0,
         "detail": "" if governed is not None else "tag policies not readable"},
        {"metric": "tag_drift", "value": float(len(key_variants) + len(roles_multi_key) + len(value_variants)),
         "detail": json.dumps({"key_variants": key_variants, "roles_multi_key": roles_multi_key,
                               "value_variants": value_variants})},
        {"metric": "tag_invalid_values", "value": float(sum(invalid_by_key.values())),
         "detail": json.dumps(invalid[:_SAMPLE])},
    ]
    return {"drift": {"key_variants": key_variants, "roles_multi_key": roles_multi_key,
                      "value_variants": value_variants},
            "invalid": invalid, "invalid_by_key": invalid_by_key, "metrics": metrics}


def review_finding(reviews: list[dict[str, Any]], scan_id: str, workspace_id: str,
                   workspace_name: str = "") -> Optional[Finding]:
    """GOV-041 from the in-app LLM review of priority columns (previous runs).

    Fires when at least 20% of the reviewed columns are judged weak or poor.
    Reviews come from the app (compass-llm), so this lags one scan behind them.
    """
    judged = [r for r in reviews if str(r.get("verdict") or "").lower() in ("good", "weak", "poor")]
    if not judged:
        return None
    bad = [r for r in judged if str(r["verdict"]).lower() in ("weak", "poor")]
    share = round(100.0 * len(bad) / len(judged), 1)
    if share < 20.0:
        return None
    poor = sum(1 for r in bad if str(r["verdict"]).lower() == "poor")
    sample = [f"{r.get('catalog')}.{r.get('schema')}.{r.get('table')}.{r.get('column')}: {r.get('reason') or ''}"[:180]
              for r in sorted(bad, key=lambda r: str(r["verdict"]).lower() != "poor")[:_SAMPLE]]
    return Finding(
        id=f"{scan_id}-GOV-041-{workspace_id}", rule_id="GOV-041", domain="governance",
        title="Low-quality descriptions on priority assets (LLM review)",
        severity=Severity.MEDIUM if share >= 40 else Severity.LOW,
        resource=f"{len(bad)} of {len(judged)} reviewed columns",
        evidence={"reviewed": len(judged), "weak_or_poor": len(bad), "poor": poor, "pct": share,
                  "models": sorted({str(r.get("model") or "") for r in judged}), "sample": sample,
                  "note": "Judged by the governed compass-llm endpoint with a fixed rubric; suggestions are "
                          "drafted as ProposedChanges for human approval."},
        remediation="Review the suggested rewrites on the Governance screen and propose the ones that are right.",
        framework_controls=["DBX-SBP:GOV-2"], scan_id=scan_id, workspace_id=workspace_id,
        workspace_name=workspace_name)
