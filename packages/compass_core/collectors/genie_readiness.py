"""Genie Ontology Readiness collector (spec: integrated port of
databricks-solutions/genie-ontology-readiness).

Produces a 0-100 overall readiness score across seven weighted pillars, each
with a 0-4 maturity level, per-pillar signals + gaps, a readiness-stage band and
gap-driven "focus next on…" guidance. The methodology (pillars, weights, exact
scoring formulas, level thresholds, readiness stages, guidance) is a faithful
port of the reference app; it is re-implemented here in Compass's collector
style — synchronous `spark.sql` read-only probes over Unity Catalog
`information_schema` (+ `system.access.audit` / `system.query.history` for the
workspace-scoped pillars), never the reference's FastAPI/OBO async code.

Data-source resilience mirrors the reference: prefer the metastore-wide
`system.information_schema` (one query covers everything); when it is not
granted, fall back to unioning each accessible catalog's own
`<catalog>.information_schema`. Every source failure resolves that pillar to
``available=False`` with an honest reason — Compass never fabricates a score
(NOT_AVAILABLE convention). Genie/adoption pillars are scoped to the workspace
this collector runs for (audit/query `workspace_id`), so — like the Genie and
Lakebase collectors — this runs only for the LOCAL workspace in the scan job.

Outputs (written by the scan job):
  inventory["genie_readiness"]          — one summary row (overall + stage + guidance)
  inventory["genie_readiness_pillars"]  — one row per pillar (score/level/signals/gaps)
  findings                              — GEN-READY-<pillar> per available pillar with a gap
"""

from __future__ import annotations

import json
from typing import Any

from ..models.capability import Availability
from ..models.finding import Finding, Severity
from .base import CollectorResult, SparkLike, cap, rows_as_dicts

# ---------------------------------------------------------------------------
# Canonical pillars / weights / bands (ported verbatim from pillars.py).
# ---------------------------------------------------------------------------
LEVEL_LABELS = ["Absent", "Initial", "Developing", "Established", "Optimized"]

PILLARS: list[dict[str, Any]] = [
    {"key": "uc_foundation", "name": "Unity Catalog Foundation", "weight": 15,
     "short": "Governed catalogs, schemas, and tables in Unity Catalog."},
    {"key": "metadata", "name": "Metadata Richness", "weight": 22,
     "short": "Comments and descriptions on tables and columns, plus tags."},
    {"key": "relationships", "name": "Relationships & Modeling", "weight": 12,
     "short": "Primary/foreign keys and a curated gold layer for analytics."},
    {"key": "metrics", "name": "Metrics", "weight": 20,
     "short": "Metric views — the governed metrics foundation that feeds the ontology."},
    {"key": "genie_agents", "name": "Genie Agents", "weight": 16,
     "short": "Curated Genie Agents with instructions, example SQL, and benchmarks."},
    {"key": "domains", "name": "Domains & Stewardship", "weight": 10,
     "short": "Business-aligned domains with named stewards and certification."},
    {"key": "adoption", "name": "Adoption & Activity", "weight": 5,
     "short": "Active users, query activity, and lineage richness."},
]
PILLARS_BY_KEY = {p["key"]: p for p in PILLARS}

# min overall score -> readiness stage label + generic (no-gaps) detail.
READINESS_STAGES = [
    (0, "Foundation building",
     "Establish Unity Catalog governance and a curated gold layer as the base for Genie."),
    (35, "Core foundation in place",
     "Core Unity Catalog governance is in place; strengthen metadata and the semantic layer next."),
    (55, "Semantics and Genie forming",
     "Metadata and a semantic layer are forming; curate and tune Genie Agents."),
    (72, "Curated and validating",
     "Genie Agents are curated; validate accuracy and onboard business users."),
    (85, "Ontology-ready",
     "Mature semantics, domains, and adoption. A strong candidate for the learned Genie Ontology preview."),
]

# Rule id per pillar (mapped to WAF pillars in rules/definitions/genie_readiness.yaml).
RULE_FOR_PILLAR = {
    "uc_foundation": "GEN-READY-UC",
    "metadata": "GEN-READY-METADATA",
    "relationships": "GEN-READY-RELATIONSHIPS",
    "metrics": "GEN-READY-METRICS",
    "genie_agents": "GEN-READY-AGENTS",
    "domains": "GEN-READY-DOMAINS",
    "adoption": "GEN-READY-ADOPTION",
}

# Catalogs that are never part of a customer's own data estate (UC footprint).
_INTERNAL_CATALOGS = ("system", "__databricks_internal", "samples", "hive_metastore")
# Cap on per-catalog readability probes in the (rare) fallback path, to bound runtime.
_MAX_FALLBACK_CATALOGS = 100
_AUDIT_LOOKBACK_DAYS = 30
# Roster window for "how many Genie Agents exist" — wider than the 30d activity
# window so a stale-but-real agent still counts toward `total` while `active`
# stays a strict 30d measure (active can therefore legitimately be < total).
_AGENT_ROSTER_LOOKBACK_DAYS = 180

_DOMAIN_TAG_KEYS = ("domain", "data_domain", "business_domain", "subject_area", "data_product")
_STEWARD_TAG_KEYS = ("owner", "data_owner", "steward", "data_steward")
_CERT_TAG_KEYS = ("system.certification_status", "certification_status")


def level_from_score(score: float) -> int:
    if score >= 85:
        return 4
    if score >= 65:
        return 3
    if score >= 40:
        return 2
    if score > 0:
        return 1
    return 0


def readiness_stage(overall: float) -> tuple[str, str]:
    label, detail = READINESS_STAGES[0][1], READINESS_STAGES[0][2]
    for mn, lab, det in READINESS_STAGES:
        if overall >= mn:
            label, detail = lab, det
    return label, detail


def _join_names(names: list[str]) -> str:
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return f"{', '.join(names[:-1])}, and {names[-1]}"


def _num(v: Any) -> float:
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).strip())
    except (ValueError, TypeError):
        return 0.0


def _pct(num: Any, den: Any) -> float:
    n, d = _num(num), _num(den)
    return round(100.0 * n / d, 1) if d else 0.0


def _qi(name: str) -> str:
    """Quote an identifier (catalog/schema) for Spark SQL."""
    return "`" + str(name).replace("`", "``") + "`"


def _lit(v: str) -> str:
    return "'" + str(v).replace("'", "''") + "'"


class GenieReadinessCollector:
    domain = "genie_readiness"

    def __init__(self, workspace_id: str, scan_id: str = "live", workspace_name: str = ""):
        self.workspace_id = str(workspace_id or "")
        self.workspace_name = workspace_name
        self.scan_id = scan_id
        self.sources: dict[str, Any] = {"system_ok": False, "catalogs": []}

    # -- source resolution ---------------------------------------------------
    def _resolve_sources(self, spark: SparkLike) -> None:
        system_ok = False
        try:
            spark.sql("SELECT 1 FROM system.information_schema.tables LIMIT 1").collect()
            system_ok = True
        except Exception:
            system_ok = False

        catalogs: list[str] = []
        try:
            if system_ok:
                rows = rows_as_dicts(spark, "SELECT catalog_name AS c FROM system.information_schema.catalogs")
                catalogs = [r.get("c") for r in rows]
            else:
                rows = rows_as_dicts(spark, "SHOW CATALOGS")
                catalogs = [list(r.values())[0] for r in rows]
        except Exception:
            catalogs = []
        catalogs = [c for c in catalogs if c and c not in _INTERNAL_CATALOGS and not str(c).startswith("__")]

        # Per-catalog readability check only matters when system is not granted:
        # SHOW CATALOGS may list catalogs the identity can only BROWSE (not SELECT),
        # which would break the UNION. Keep only readable ones (bounded).
        if not system_ok and catalogs:
            readable: list[str] = []
            for c in catalogs[:_MAX_FALLBACK_CATALOGS]:
                try:
                    spark.sql(f"SELECT 1 FROM {_qi(c)}.information_schema.tables LIMIT 1").collect()
                    readable.append(c)
                except Exception:
                    pass
            catalogs = readable

        self.sources = {"system_ok": system_ok, "catalogs": catalogs}

    def _src(self, view: str) -> str | None:
        """FROM-able source for an information_schema view (aliased _t)."""
        if self.sources["system_ok"]:
            return f"system.information_schema.{view} AS _t"
        cats = self.sources["catalogs"]
        if not cats:
            return None
        union = " UNION ALL ".join(f"SELECT * FROM {_qi(c)}.information_schema.{view}" for c in cats)
        return f"({union}) AS _t"

    def _internal_filter(self, col: str = "table_catalog") -> str:
        """Exclude internal catalogs when grouping over the metastore-wide view.
        Per-catalog union mode is already scoped, so it needs none. `col` selects
        the catalog column (information_schema.tables/columns use `table_catalog`;
        the *_tags views use `catalog_name`)."""
        if not self.sources["system_ok"]:
            return ""
        in_list = ", ".join(_lit(c) for c in _INTERNAL_CATALOGS)
        return f" AND {col} NOT IN ({in_list}) AND {col} NOT RLIKE '^__' "

    def _scalar(self, spark: SparkLike, query: str) -> Any:
        rows = spark.sql(query).collect()
        if not rows:
            return None
        return list(rows[0].asDict(recursive=True).values())[0]

    def _ws_pred(self, column: str = "workspace_id") -> str:
        if not self.workspace_id:
            return ""
        return f" AND CAST({column} AS STRING) = {_lit(self.workspace_id)} "

    # -- pillar probes -------------------------------------------------------
    def _p_uc_foundation(self, spark: SparkLike) -> dict:
        n_catalogs = len(self.sources["catalogs"])
        tbl = self._src("tables")
        sch = self._src("schemata")
        if tbl is None or sch is None:
            if not self.sources["system_ok"]:
                return _empty("No catalogs are readable for the assessment. Grant the scan identity "
                              "USE CATALOG + SELECT on the catalogs to assess.", "insufficient_permission")
        try:
            n_schemas = int(_num(self._scalar(
                spark, f"SELECT COUNT(*) FROM {sch} WHERE schema_name <> 'information_schema'")))
            total = int(_num(self._scalar(
                spark, f"SELECT COUNT(*) FROM {tbl} WHERE table_schema <> 'information_schema'"
                       f"{self._internal_filter()}")))
        except Exception as e:
            return _failed(e, "The Unity Catalog footprint")

        score = 0.0
        if n_catalogs:
            score += 40
        if total > 0:
            score += 30
        if total >= 50:
            score += 15
        if n_schemas and n_schemas >= 5:
            score += 15
        score = min(score, 100.0)

        gaps = []
        if not n_catalogs:
            gaps.append("No user catalogs found — Unity Catalog may not be in active use.")
        if total < 50:
            gaps.append("Limited table footprint; broaden UC adoption beyond an initial workload.")

        return {"available": True, "score": round(score, 1),
                "signals": [
                    {"label": "Catalogs", "value": n_catalogs, "detail": "User catalogs assessed"},
                    {"label": "Schemas", "value": n_schemas, "detail": "Excluding information_schema"},
                    {"label": "Tables", "value": total, "detail": "Tables in Unity Catalog"}],
                "gaps": gaps,
                "metrics": {"catalogs": n_catalogs, "schemas": n_schemas, "tables": total}}

    def _p_metadata(self, spark: SparkLike) -> dict:
        tbl = self._src("tables")
        col = self._src("columns")
        if tbl is None:
            return _empty(_no_cat("metadata assessment"), "insufficient_permission")
        try:
            trow = rows_as_dicts(
                spark,
                "SELECT COUNT(*) AS total, "
                "SUM(CASE WHEN comment IS NOT NULL AND comment <> '' THEN 1 ELSE 0 END) AS commented "
                f"FROM {tbl} WHERE table_schema <> 'information_schema'{self._internal_filter()}")
            t_total = int(_num(trow[0].get("total"))) if trow else 0
            t_commented = int(_num(trow[0].get("commented"))) if trow else 0

            c_total = c_commented = 0
            if col is not None:
                crow = rows_as_dicts(
                    spark,
                    "SELECT COUNT(*) AS total, "
                    "SUM(CASE WHEN comment IS NOT NULL AND comment <> '' THEN 1 ELSE 0 END) AS commented "
                    f"FROM {col} WHERE table_schema <> 'information_schema'{self._internal_filter()}")
                c_total = int(_num(crow[0].get("total"))) if crow else 0
                c_commented = int(_num(crow[0].get("commented"))) if crow else 0

            tagged_tables = None
            tt = self._src("table_tags")
            if tt is not None:
                try:
                    tagged_tables = int(_num(self._scalar(
                        spark, f"SELECT COUNT(DISTINCT table_name) FROM {tt}")))
                except Exception:
                    tagged_tables = None
        except Exception as e:
            return _failed(e, "Comment coverage")

        table_pct = _pct(t_commented, t_total)
        col_pct = _pct(c_commented, c_total)
        score = round(0.5 * table_pct + 0.5 * col_pct, 1)

        gaps = []
        if table_pct < 80:
            gaps.append(f"Only {table_pct}% of tables have descriptions — Genie relies on these to understand data.")
        if col_pct < 60:
            gaps.append(f"Only {col_pct}% of columns are commented; aim for high coverage on gold-layer columns.")
        if tagged_tables is not None and t_total and tagged_tables == 0:
            gaps.append("No governed tags found; tags aid discovery and domain organization.")

        signals = [
            {"label": "Tables commented", "value": table_pct, "unit": "%", "detail": f"{t_commented} of {t_total} tables"},
            {"label": "Columns commented", "value": col_pct, "unit": "%", "detail": f"{c_commented} of {c_total} columns"},
        ]
        if tagged_tables is not None:
            signals.append({"label": "Tagged tables", "value": tagged_tables, "detail": "Tables with ≥1 governed tag"})

        return {"available": True, "score": score, "signals": signals, "gaps": gaps,
                "metrics": {"table_comment_pct": table_pct, "column_comment_pct": col_pct,
                            "tagged_tables": tagged_tables}}

    def _p_relationships(self, spark: SparkLike) -> dict:
        tbl = self._src("tables")
        if tbl is None:
            return _empty(_no_cat("relationship assessment"), "insufficient_permission")
        try:
            constraints_available = True
            pk = fk = 0
            tc = self._src("table_constraints")
            try:
                rows = rows_as_dicts(spark, f"SELECT constraint_type, COUNT(*) AS n FROM {tc} GROUP BY constraint_type") if tc else []
                by_type = {r["constraint_type"]: int(_num(r.get("n"))) for r in rows}
                pk = by_type.get("PRIMARY KEY", 0)
                fk = by_type.get("FOREIGN KEY", 0)
                if tc is None:
                    constraints_available = False
            except Exception:
                constraints_available = False

            gold_tables = int(_num(self._scalar(
                spark,
                f"SELECT COUNT(*) FROM {tbl} "
                "WHERE (lower(table_schema) RLIKE '(gold|mart|marts|analytics|semantic|presentation|reporting|dwh)' "
                "   OR lower(table_name) RLIKE '^(gold_|mart_|dim_|fact_)')"
                f"{self._internal_filter()}")))
        except Exception as e:
            return _failed(e, "Relationships and modeling")

        score = 0.0
        if gold_tables > 0:
            score += 50
        if constraints_available:
            if fk > 0:
                score += 35
            if pk > 0:
                score += 15
        score = min(score, 100.0)

        gaps = []
        if not gold_tables:
            gaps.append("No clearly-named gold/mart layer detected; Genie performs best on curated, pre-joined tables.")
        if constraints_available and fk == 0:
            gaps.append("No foreign-key constraints declared; PK/FK relationships let Genie infer joins reliably.")

        signals = [{"label": "Gold-layer tables", "value": gold_tables, "detail": "Tables in gold/mart/analytics-style schemas"}]
        if constraints_available:
            signals += [
                {"label": "Primary keys", "value": pk, "detail": "Declared PK constraints"},
                {"label": "Foreign keys", "value": fk, "detail": "Declared FK constraints"},
            ]
        note = None if constraints_available else "Constraint metadata not available; score is based on the gold layer only."
        return {"available": True, "score": round(score, 1), "signals": signals, "gaps": gaps, "note": note,
                "metrics": {"primary_keys": pk, "foreign_keys": fk, "gold_tables": gold_tables,
                            "constraints_available": constraints_available}}

    def _p_metrics(self, spark: SparkLike) -> dict:
        tbl = self._src("tables")
        if tbl is None:
            return _empty(_no_cat("semantic-layer assessment"), "insufficient_permission")
        metric_views = None
        type_value = None
        for tv in ("METRIC_VIEW", "METRIC VIEW"):
            try:
                metric_views = int(_num(self._scalar(
                    spark, f"SELECT COUNT(*) FROM {tbl} WHERE table_type = {_lit(tv)}")))
                type_value = tv
                break
            except Exception:
                continue
        if metric_views is None:
            return _empty("Metric view metadata not available on this metastore version.", "not_enabled")

        if metric_views == 0:
            return {"available": True, "score": 0.0,
                    "signals": [{"label": "Metric views", "value": 0, "detail": "UC metric views"}],
                    "gaps": ["No metric views found. Metric views are the GA foundation that feeds Genie Ontology — "
                             "define KPIs centrally here."],
                    "metrics": {"metric_views": 0}}

        commented = 0
        try:
            commented = int(_num(self._scalar(
                spark, f"SELECT COUNT(*) FROM {tbl} WHERE table_type = {_lit(type_value)} "
                       "AND comment IS NOT NULL AND trim(comment) <> ''")))
        except Exception:
            commented = 0

        score = 30.0 + 40.0 * min(metric_views, 10) / 10.0
        score += 30.0 * (float(commented) / float(metric_views)) if metric_views > 0 else 0.0
        score = round(min(score, 100.0), 1)

        signals = [{"label": "Metric views", "value": metric_views, "detail": "UC metric views"}]
        if metric_views > 0:
            signals.append({"label": "Commented", "value": _pct(commented, metric_views), "unit": "%",
                            "detail": "Share of metric views with a description"})
        gaps = []
        if metric_views < 3:
            gaps.append("Few metric views; expand coverage so common KPIs are centrally defined and certified.")
        uncommented = metric_views - commented
        if uncommented > 0:
            gaps.append(f"{uncommented} metric view(s) lack a description — Genie reads metric-view, dimension, and "
                        "measure comments to reason; add them.")
        return {"available": True, "score": score, "signals": signals, "gaps": gaps,
                "metrics": {"metric_views": metric_views, "metric_views_commented": commented}}

    def _p_genie_agents(self, spark: SparkLike) -> dict:
        # Count Genie Agents from the workspace's audit log (aibiGenie), excluding
        # ever-trashed spaces; active = distinct spaces with activity in last 30d.
        try:
            row = rows_as_dicts(
                spark,
                "SELECT COUNT(*) AS total, SUM(CASE WHEN active_30d = 1 THEN 1 ELSE 0 END) AS active_30d FROM ("
                "  SELECT request_params.space_id AS space_id, "
                "         MAX(CASE WHEN lower(action_name) = 'trashspace' THEN 1 ELSE 0 END) AS trashed, "
                f"         MAX(CASE WHEN event_date >= current_date() - INTERVAL {_AUDIT_LOOKBACK_DAYS} DAYS THEN 1 ELSE 0 END) AS active_30d "
                "  FROM system.access.audit "
                "  WHERE service_name = 'aibiGenie' AND request_params.space_id IS NOT NULL "
                "    AND request_params.space_id <> 'new' "
                f"    AND event_date >= current_date() - INTERVAL {_AGENT_ROSTER_LOOKBACK_DAYS} DAYS "
                f"    {self._ws_pred()}"
                "  GROUP BY request_params.space_id "
                ") WHERE trashed = 0")
        except Exception:
            return _empty("Genie usage can't be read — the scan identity needs SELECT on system.access.audit.",
                          "insufficient_permission")

        total = int(_num(row[0].get("total"))) if row else 0
        active = int(_num(row[0].get("active_30d"))) if row else 0

        score = 0.0
        if total > 0:
            score += 40
        if active > 0:
            score += 40
        if total > 0 and active / total >= 0.30:
            score += 20
        score = min(score, 100.0)

        gaps = []
        if total == 0:
            gaps.append("No Genie Agents found in the audit log — create a curated Genie Agent as the entry point "
                        "to natural-language analytics.")
        elif active == 0:
            gaps.append(f"{total} Genie Agent(s) exist but none were active in the last 30 days — "
                        "drive adoption or retire stale agents.")

        return {"available": True, "score": round(score, 1),
                "signals": [
                    {"label": "Genie Agents", "value": total, "detail": f"Distinct agents in the audit log ({_AGENT_ROSTER_LOOKBACK_DAYS}d)"},
                    {"label": "Active agents (30d)", "value": active, "detail": "Distinct agents active in the last 30 days"}],
                "gaps": gaps,
                "note": "Curation quality (instructions, verified SQL, benchmarks) isn't visible in the audit log; "
                        "use the Genie Agent Quality Workshop accelerator to assess and lift it.",
                "metrics": {"genie_agents": total, "active_30d": active}}

    def _p_domains(self, spark: SparkLike) -> dict:
        tt = self._src("table_tags")
        st = self._src("schema_tags")
        tbl = self._src("tables")
        if tt is None:
            return _empty("No readable catalogs for the domain/tag proxy (the native UC Domains API is a gated "
                          "preview and isn't read from the scan job).", "insufficient_permission")
        try:
            dk = ", ".join(_lit(k) for k in _DOMAIN_TAG_KEYS)
            sk = ", ".join(_lit(k) for k in _STEWARD_TAG_KEYS)
            ck = ", ".join(_lit(k) for k in _CERT_TAG_KEYS)

            parts = [f"SELECT tag_value FROM {tt} WHERE lower(tag_name) IN ({dk})"]
            if st is not None:
                parts.append(f"SELECT tag_value FROM {st} WHERE lower(tag_name) IN ({dk})")
            drow = rows_as_dicts(
                spark,
                f"SELECT COUNT(DISTINCT tag_value) AS distinct_domains, COUNT(*) AS assignments "
                f"FROM ({' UNION ALL '.join(parts)})")
            distinct_domains = int(_num(drow[0].get("distinct_domains"))) if drow else 0
            assignments = int(_num(drow[0].get("assignments"))) if drow else 0

            stewarded = 0
            try:
                stewarded = int(_num(self._scalar(
                    spark, f"SELECT COUNT(*) FROM {tt} WHERE lower(tag_name) IN ({sk})")))
            except Exception:
                stewarded = 0
            certified = 0
            try:
                certified = int(_num(self._scalar(
                    spark,
                    f"SELECT COUNT(DISTINCT concat_ws('.', catalog_name, schema_name, table_name)) "
                    f"FROM {tt} WHERE lower(tag_name) IN ({ck}) AND lower(tag_value) = 'certified'")))
            except Exception:
                certified = 0

            total_tables = governed_tagged = domain_tagged = 0
            try:
                total_tables = int(_num(self._scalar(
                    spark, f"SELECT COUNT(*) FROM {tbl} WHERE table_schema <> 'information_schema'"
                           f"{self._internal_filter()}"))) if tbl else 0
            except Exception:
                total_tables = 0
            try:
                governed_tagged = int(_num(self._scalar(
                    spark, f"SELECT COUNT(DISTINCT concat_ws('.', catalog_name, schema_name, table_name)) FROM {tt} "
                           f"WHERE 1=1{self._internal_filter('catalog_name')}")))
            except Exception:
                governed_tagged = 0
            try:
                domain_tagged = int(_num(self._scalar(
                    spark, f"SELECT COUNT(DISTINCT concat_ws('.', catalog_name, schema_name, table_name)) "
                           f"FROM {tt} WHERE lower(tag_name) IN ({dk}){self._internal_filter('catalog_name')}")))
            except Exception:
                domain_tagged = 0
        except Exception as e:
            return _failed(e, "Domains and stewardship")

        pct_tagged = _pct(governed_tagged, total_tables)
        pct_in_domain = _pct(domain_tagged, total_tables)

        score = 0.0
        if distinct_domains > 0:
            score += 40 + 40 * min(distinct_domains, 5) / 5
        if stewarded > 0:
            score += 20
        score = min(score, 100.0)

        gaps = []
        if distinct_domains == 0:
            gaps.append("No domain-style governed tags found (e.g. a `domain` tag). Organize assets into "
                        "business-aligned domains.")
        if stewarded == 0:
            gaps.append("No stewardship tags (owner/steward) found; assign a named steward per domain.")
        if certified == 0:
            gaps.append("No certified assets found — certify canonical gold tables so users (and Genie) know which "
                        "to trust.")
        if total_tables and pct_tagged < 50:
            gaps.append(f"Only {pct_tagged}% of tables carry any UC governed tag — tag eligible assets "
                        "(PII, domain, certification) to power governed discovery.")
        if total_tables and pct_in_domain < 50:
            gaps.append(f"Only {pct_in_domain}% of tables are assigned to a domain — apply domain tags so assets "
                        "roll up to business-aligned domains.")

        signals = [
            {"label": "Distinct domains (via tags)", "value": distinct_domains, "detail": "Distinct domain-style tag values"},
            {"label": "Domain-tagged assets", "value": assignments, "detail": "Assets carrying a domain tag"},
            {"label": "Stewarded assets", "value": stewarded, "detail": "Assets with an owner/steward tag"},
            {"label": "Certified assets", "value": certified, "detail": "Tables tagged certification_status = certified"},
        ]
        if total_tables:
            signals.append({"label": "Tables tagged", "value": pct_tagged, "unit": "%",
                            "detail": f"{governed_tagged} of {total_tables} tables carry a UC governed tag"})
            signals.append({"label": "Tables in a domain", "value": pct_in_domain, "unit": "%",
                            "detail": f"{domain_tagged} of {total_tables} tables carry a domain tag"})
        return {"available": True, "score": round(score, 1), "signals": signals, "gaps": gaps,
                "note": "Assessed via governed tags (the native UC Domains feature is a gated preview).",
                "metrics": {"distinct_domains": distinct_domains, "domain_tag_assignments": assignments,
                            "stewarded_assets": stewarded, "certified_assets": certified,
                            "total_tables": total_tables, "governed_tagged_assets": governed_tagged,
                            "pct_tagged": pct_tagged, "domain_tagged_assets": domain_tagged,
                            "pct_in_domain": pct_in_domain}}

    def _p_adoption(self, spark: SparkLike) -> dict:
        active_users = None
        queries_30d = None
        try:
            active_users = int(_num(self._scalar(
                spark,
                "SELECT COUNT(DISTINCT user_identity.email) FROM system.access.audit "
                f"WHERE event_date >= current_date() - INTERVAL 30 DAYS {self._ws_pred()}")))
        except Exception:
            active_users = None
        try:
            queries_30d = int(_num(self._scalar(
                spark,
                "SELECT COUNT(*) FROM system.query.history "
                f"WHERE start_time >= current_timestamp() - INTERVAL 30 DAYS {self._ws_pred()}")))
        except Exception:
            queries_30d = None

        if active_users is None and queries_30d is None:
            return _empty("System tables (system.access / system.query) are not enabled or not granted to the "
                          "scan identity.", "not_enabled")

        def _band(u: int | None) -> float:
            u = u or 0
            if u <= 0:
                return 0.0
            if u < 5:
                return 20.0
            if u < 20:
                return 35.0
            if u < 50:
                return 45.0
            return 50.0

        score = _band(active_users)
        if queries_30d and queries_30d > 0:
            score += 50
        score = min(score, 100.0)

        signals = []
        if active_users is not None:
            signals.append({"label": "Active users (30d)", "value": active_users, "detail": "Distinct users in audit log"})
        if queries_30d is not None:
            signals.append({"label": "Queries (30d)", "value": queries_30d, "detail": "Query history volume"})

        # Emit gaps when adoption is genuinely absent/low, so GEN-READY-ADOPTION can
        # fire. Only assess a signal that was actually readable (skip None sources).
        gaps = []
        if active_users is not None and active_users == 0:
            gaps.append("No active users in the last 30 days — onboard business users so Genie has an audience.")
        elif active_users is not None and active_users < 5:
            gaps.append(f"Only {active_users} active user(s) in the last 30 days — broaden adoption beyond a small pilot.")
        if queries_30d is not None and queries_30d == 0:
            gaps.append("No query activity in the last 30 days — analytics usage is a prerequisite for Genie adoption.")
        return {"available": True, "score": round(score, 1), "signals": signals, "gaps": gaps,
                "metrics": {"active_users_30d": active_users, "queries_30d": queries_30d}}

    # -- orchestration -------------------------------------------------------
    def collect(self, spark: SparkLike) -> CollectorResult:
        res = CollectorResult()
        try:
            self._resolve_sources(spark)
        except Exception as e:  # pragma: no cover
            res.capabilities.append(cap("genie_readiness", "system.information_schema",
                                        Availability.NOT_AVAILABLE, str(e)[:200]))
            return res

        probes = {
            "uc_foundation": self._p_uc_foundation,
            "metadata": self._p_metadata,
            "relationships": self._p_relationships,
            "metrics": self._p_metrics,
            "genie_agents": self._p_genie_agents,
            "domains": self._p_domains,
            "adoption": self._p_adoption,
        }

        pillar_rows: list[dict] = []
        assembled: list[dict] = []
        for p in PILLARS:
            key = p["key"]
            try:
                probe = probes[key](spark)
            except Exception as e:  # pragma: no cover
                probe = _empty(f"{p['name']} could not be assessed ({str(e)[:120]}).", "scan_failed")
            available = bool(probe.get("available"))
            tech_score = round(float(probe.get("score") or 0.0), 1)
            score = tech_score if available else 0.0
            level = level_from_score(score)
            entry = {
                "key": key, "name": p["name"], "weight": p["weight"], "score": score,
                "technical_score": tech_score if available else None, "level": level,
                "level_label": LEVEL_LABELS[level], "available": available,
                "unavailable_reason": probe.get("unavailable_reason"),
                "note": probe.get("note"),
                "signals": probe.get("signals", []), "gaps": probe.get("gaps", []),
                "metrics": probe.get("metrics", {}),
            }
            assembled.append(entry)
            pillar_rows.append({
                "scan_id": self.scan_id, "workspace_id": self.workspace_id, "workspace_name": self.workspace_name,
                "pillar_key": key, "name": p["name"], "weight": p["weight"], "score": float(score),
                "technical_score": (float(tech_score) if available else None), "level": level,
                "level_label": LEVEL_LABELS[level], "available": available,
                "unavailable_reason": probe.get("unavailable_reason"),
                "signals_json": json.dumps(entry["signals"], default=str),
                "gaps_json": json.dumps(entry["gaps"], default=str),
                "metrics_json": json.dumps(entry["metrics"], default=str),
            })

        # overall = weighted mean over AVAILABLE pillars only, renormalized over
        # their weights. Unavailable pillars (ungranted sources) are excluded from
        # BOTH numerator and denominator so an honest NOT_AVAILABLE never silently
        # deflates the score to 0 (diverges from the OSS reference — see DECISIONS).
        available = [p for p in assembled if p["available"]]
        weight_total = sum(p["weight"] for p in available)
        weighted_sum = sum(p["score"] * p["weight"] for p in available)
        overall = round(weighted_sum / weight_total, 1) if weight_total else 0.0
        overall_level = level_from_score(overall)
        stage_label, stage_detail = readiness_stage(overall)

        # prioritized gaps + guidance: lowest-score first, then highest-weight.
        ranked = sorted(assembled, key=lambda x: (x["score"], -x["weight"]))
        top_gaps = []
        for pil in ranked:
            for g in pil["gaps"]:
                top_gaps.append({"pillar": pil["name"], "gap": g})
        top_gaps = top_gaps[:6]

        gap_pillars: list[str] = []
        for pil in ranked:
            if pil["gaps"] and pil["name"] not in gap_pillars:
                gap_pillars.append(pil["name"])
            if len(gap_pillars) == 3:
                break
        guidance = (f"Focus next on {_join_names(gap_pillars)}: your lowest-scoring, highest-impact areas."
                    if gap_pillars else stage_detail)

        res.inventory["genie_readiness_pillars"] = pillar_rows
        res.inventory["genie_readiness"] = [{
            "scan_id": self.scan_id, "workspace_id": self.workspace_id, "workspace_name": self.workspace_name,
            "overall_score": float(overall), "level": overall_level, "level_label": LEVEL_LABELS[overall_level],
            "readiness_stage": stage_label, "guidance": guidance,
            "top_gaps_json": json.dumps(top_gaps, default=str),
            "pillars_available": len(available),
            "pillars_total": len(assembled),
            "assessed_at": _now_iso(),
        }]

        n_available = sum(1 for p in assembled if p["available"])
        if n_available == 0:
            res.capabilities.append(cap("genie_readiness", "system.information_schema/system.access.audit",
                                        Availability.NOT_AVAILABLE,
                                        "No readiness pillar could be assessed — grant the scan identity SELECT on "
                                        "the catalogs' information_schema and on system.access/system.query."))
        else:
            res.capabilities.append(cap("genie_readiness", "system.information_schema/system.access.audit",
                                        Availability.AVAILABLE))

        # Findings: one per AVAILABLE pillar that shows a gap; severity scales by
        # maturity level (never fabricate for unavailable pillars).
        sev_for = {0: Severity.HIGH, 1: Severity.MEDIUM, 2: Severity.LOW}
        for p in assembled:
            if not p["available"] or not p["gaps"] or p["level"] >= 3:
                continue
            rule_id = RULE_FOR_PILLAR[p["key"]]
            res.findings.append(Finding(
                id=f"{self.scan_id}-{rule_id}-{self.workspace_id}",
                rule_id=rule_id,
                domain="genie_readiness",
                title=f"Genie readiness gap — {p['name']} ({p['level_label']}, {p['score']}/100)",
                severity=sev_for.get(p["level"], Severity.LOW),
                resource=f"pillar: {p['name']} · ws {self.workspace_name or self.workspace_id}",
                evidence={"pillar": p["key"], "score": p["score"], "level": p["level"],
                          "level_label": p["level_label"], "weight": p["weight"],
                          "gaps": p["gaps"], "signals": p["signals"], "metrics": p["metrics"]},
                remediation="; ".join(p["gaps"][:3]),
                framework_controls=["DBX-SBP:GOV-2"],
                scan_id=self.scan_id,
                workspace_id=self.workspace_id,
                workspace_name=self.workspace_name,
            ))
        return res


# ---------------------------------------------------------------------------
# helpers (module-level, mirror the reference's uniform result shapes)
# ---------------------------------------------------------------------------
def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _empty(note: str, reason: str | None = None) -> dict:
    return {"available": False, "score": 0.0, "signals": [], "gaps": [], "note": note,
            "metrics": {}, "unavailable_reason": reason}


def _failed(exc: Exception, what: str) -> dict:
    return _empty(f"{what} could not be read. ({str(exc)[:120]})", "scan_failed")


def _no_cat(what: str) -> str:
    return (f"No readable catalogs for the {what}. Grant the scan identity USE CATALOG + SELECT on the "
            "catalogs to assess.")
