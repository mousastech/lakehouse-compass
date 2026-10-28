"""Sensitive-data protection collector (Phase 2 — P4).

Crosses *where sensitive data is* with *what protects it*:

  sensitive column  (column tag mapped to the `sensitivity` role — class.*, pii,
                     phi… — or a HIGH-confidence Data Classification detection)
    ├─ direct column mask (information_schema.column_masks)          → protected
    ├─ ABAC COLUMN_MASK policy whose governed tags match the column's
    │  tag, attached to the table or an ancestor                     → protected
    └─ nothing visible                                               → SEC-040

Sources and honesty rules:
  * `system.data_classification.results` is read with explicit columns only —
    never `samples`, which holds real data values. Without the grant (account
    admin by default) the detection-based checks are skipped, not guessed.
  * ABAC policies are only visible where the scan identity has MANAGE, so the
    count of visible policies travels with every finding.
  * Name-based candidates (email, cpf, phone…) are a labelled heuristic with
    their own low-severity rule (SEC-042); they never feed SEC-040.
  * Data Classification enablement per catalog comes from the Data
    Classification API (local workspace) → GOV-036.

Findings: SEC-040, SEC-041, SEC-042 (security) and GOV-036 (governance).
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Callable, Optional
from urllib.parse import quote

from ..models.capability import Availability
from ..models.finding import Finding, Severity
from ..tag_profile import TagProfile, sql_str
from .base import CollectorResult, SparkLike, cap, rows_as_dicts
from .metadata import _system_src, internal_filter

# Values of a sensitivity tag that explicitly mean "not sensitive".
_NEGATIVE_VALUES = {"false", "no", "none", "0", "n/a", "na", "public", "nao", "não"}
# Column names that usually hold personal or confidential data (heuristic only).
_NAME_HEURISTIC_RE = (
    "(^|_)(e?mail|cpf|cnpj|ssn|rg|passport|passaporte|phone|telefone|celular|mobile|birth_?date"
    "|data_nascimento|nascimento|dob|address|endereco|cep|zip_?code|postal_code|credit_card|card_number"
    "|cartao|iban|tax_id|nif|rut|curp|rfc|first_name|last_name|full_name|nome_completo|nome_cliente"
    "|customer_name|salary|salario|renda|income)(_|$)"
)
_STORE_LIMIT = 2000  # sensitive-column rows persisted per scan (counts are always exact)
_SAMPLE = 10


def _fq(r: dict[str, Any]) -> tuple[str, str, str, str]:
    return (str(r.get("c")), str(r.get("s")), str(r.get("t")), str(r.get("col")))


class ProtectionCollector:
    domain = "security"

    def __init__(self, profile: TagProfile, workspace_id: str, scan_id: str = "live", workspace_name: str = "",
                 rest: Optional[Callable[..., dict]] = None):
        self.profile = profile
        self.workspace_id = workspace_id
        self.workspace_name = workspace_name
        self.scan_id = scan_id
        self.rest = rest

    # -- queries ------------------------------------------------------------------
    def _tagged(self, spark: SparkLike) -> list[dict]:
        role = self.profile.role_case_sql("tag_name")
        return rows_as_dicts(spark, f"""
            SELECT catalog_name AS c, schema_name AS s, table_name AS t, column_name AS col,
                   tag_name AS k, tag_value AS v
            FROM {_system_src('column_tags')}
            WHERE {role} = 'sensitivity'{internal_filter('catalog_name')}""")

    def _masks(self, spark: SparkLike) -> list[dict]:
        return rows_as_dicts(spark, f"""
            SELECT table_catalog AS c, table_schema AS s, table_name AS t, column_name AS col, mask_name
            FROM {_system_src('column_masks')} WHERE 1=1{internal_filter('table_catalog')}""")

    def _abac(self, spark: SparkLike) -> list[dict]:
        return rows_as_dicts(spark, f"""
            SELECT policy_name, catalog_name AS c, schema_name AS s, securable_name AS t,
                   g.tag_key AS k, g.tag_value AS v
            FROM {_system_src('abac_policy_definitions')}
            LATERAL VIEW OUTER explode(governed_tags) e AS g
            WHERE policy_type = 'COLUMN_MASK'""")

    def _detections(self, spark: SparkLike) -> list[dict]:
        # Explicit columns only — `samples` holds real values and is never selected.
        return rows_as_dicts(spark, f"""
            SELECT catalog_name AS c, schema_name AS s, table_name AS t, column_name AS col,
                   class_tag AS k, confidence
            FROM system.data_classification.results
            WHERE confidence = 'HIGH'{internal_filter('catalog_name')}""")

    def _name_candidates(self, spark: SparkLike) -> list[dict]:
        return rows_as_dicts(spark, f"""
            SELECT table_catalog AS c, table_schema AS s, table_name AS t, column_name AS col,
                   regexp_extract(lower(column_name), {sql_str(_NAME_HEURISTIC_RE)}, 2) AS hint
            FROM {_system_src('columns')}
            WHERE table_schema <> 'information_schema'{internal_filter('table_catalog')}
              AND lower(column_name) RLIKE {sql_str(_NAME_HEURISTIC_RE)}""")

    def _classification_config(self) -> Optional[list[dict]]:
        """Per managed catalog: is Data Classification configured? None = API not readable."""
        if self.rest is None:
            return None
        cats: list[dict] = []
        token = ""
        for _ in range(20):  # the API pages even under max_results
            resp = self.rest("GET", "/api/2.1/unity-catalog/catalogs?max_results=1000"
                                    + (f"&page_token={quote(token, safe='')}" if token else "")) or {}
            cats += resp.get("catalogs") or []
            token = resp.get("next_page_token") or ""
            if not token:
                break
        out = []
        for c in cats:
            name, ctype = str(c.get("name") or ""), str(c.get("catalog_type") or "")
            if not name or ctype != "MANAGED_CATALOG" or name in ("system", "samples", "hive_metastore") \
                    or name.startswith("__"):
                continue
            try:
                cfg = self.rest("GET", f"/api/data-classification/v1/catalogs/{quote(name, safe='')}/config") or {}
                out.append({"catalog": name, "enabled": True, "detail": ",".join(sorted(cfg.keys()))[:200]})
            except Exception as e:
                # The config resource is what enables classification: absent = not enabled.
                if "not found" in str(e).lower() or "404" in str(e):
                    out.append({"catalog": name, "enabled": False, "detail": "no Data Classification config"})
                else:
                    out.append({"catalog": name, "enabled": None, "detail": str(e)[:160]})
        return out

    # -- orchestration --------------------------------------------------------------
    def collect(self, spark: SparkLike) -> CollectorResult:
        res = CollectorResult()
        try:
            tagged = self._tagged(spark)
            masks = self._masks(spark)
        except Exception as e:
            res.capabilities.append(cap("tags", "system.information_schema", Availability.NOT_AVAILABLE, str(e)[:300]))
            return res

        abac: Optional[list[dict]]
        try:
            abac = self._abac(spark)
            res.capabilities.append(cap("abac_policies", "information_schema.abac_policy_definitions",
                                        Availability.AVAILABLE))
        except Exception as e:
            abac = None
            res.capabilities.append(cap("abac_policies", "information_schema.abac_policy_definitions",
                                        Availability.NOT_AVAILABLE, str(e)[:200]))
        detections: Optional[list[dict]]
        try:
            detections = self._detections(spark)
        except Exception:
            detections = None  # capability `data_classification` is reported by the governance collector
        try:
            candidates = self._name_candidates(spark)
        except Exception as e:
            print(f"[compass] name heuristic failed: {str(e)[:160]}")
            candidates = []
        config: Optional[list[dict]] = None
        try:
            config = self._classification_config()
            if config is not None:
                res.capabilities.append(cap("data_classification_config", "data_classification_api",
                                            Availability.AVAILABLE))
        except Exception as e:
            res.capabilities.append(cap("data_classification_config", "data_classification_api",
                                        Availability.NOT_AVAILABLE, str(e)[:200]))
        if config is None and not any(c.id == "data_classification_config" for c in res.capabilities):
            res.capabilities.append(cap("data_classification_config", "data_classification_api",
                                        Availability.NOT_AVAILABLE, "Data Classification API is read from the "
                                                                     "local workspace only."))

        shaped = evaluate_protection(tagged, masks, abac, detections, candidates)
        res.inventory["sensitive_columns"] = [self._row(**r) for r in shaped["columns"][:_STORE_LIMIT]]
        if config is not None:
            res.inventory["classification_coverage"] = [self._row(**c) for c in config]
        res.inventory["governance_metrics"] = [
            {"scan_id": self.scan_id, "workspace_id": self.workspace_id, **m} for m in shaped["metrics"]]
        if config is not None:
            on = sum(1 for c in config if c["enabled"])
            res.inventory["governance_metrics"].append(
                {"scan_id": self.scan_id, "workspace_id": self.workspace_id,
                 "metric": "classification_catalogs_enabled", "value": float(on), "detail": f"of {len(config)}"})
        res.findings += self._findings(shaped, abac, detections, config)
        return res

    # -- shaping --------------------------------------------------------------------
    def _row(self, **kw: Any) -> dict[str, Any]:
        return {"scan_id": self.scan_id, "workspace_id": self.workspace_id,
                "workspace_name": self.workspace_name, **kw}

    def _finding(self, rule_id: str, domain: str, title: str, severity: Severity, resource: str,
                 evidence: dict, remediation: str, controls: list[str]) -> Finding:
        return Finding(
            id=f"{self.scan_id}-{rule_id}-{self.workspace_id}", rule_id=rule_id, domain=domain, title=title,
            severity=severity, resource=resource, evidence=evidence, remediation=remediation,
            framework_controls=controls, scan_id=self.scan_id, workspace_id=self.workspace_id,
            workspace_name=self.workspace_name)

    def _findings(self, shaped: dict, abac: Optional[list[dict]], detections: Optional[list[dict]],
                  config: Optional[list[dict]]) -> list[Finding]:
        out: list[Finding] = []
        cols = shaped["columns"]
        visible = len({a.get("policy_name") for a in (abac or [])})
        fq = lambda r: f"{r['catalog']}.{r['schema']}.{r['table']}.{r['column']}"  # noqa: E731

        unprotected = [r for r in cols if r["source"] in ("tag", "classification") and r["protection"] == "none"]
        if unprotected:
            sensitive = sum(1 for r in cols if r["source"] in ("tag", "classification"))
            out.append(self._finding(
                "SEC-040", "security", "Sensitive columns without a visible mask", Severity.HIGH,
                f"{len(unprotected)} of {sensitive} sensitive columns",
                {"unprotected": len(unprotected), "sensitive": sensitive,
                 "by_tag": _count(unprotected, "tag_key"), "sample": [fq(r) for r in unprotected[:_SAMPLE]],
                 "abac_policies_visible": visible,
                 "note": "ABAC policies are only visible where the scan identity has MANAGE; a policy the scan "
                         "cannot see may still protect these columns."},
                "Attach an ABAC column-mask policy on the sensitivity tag at catalog/schema level (one policy "
                "covers every tagged column), or a direct column mask.",
                ["DBX-SBP:DATA-1", "LGPD:Art.46", "GDPR:Art.32"]))

        if detections is not None:
            untagged = [r for r in cols if r["source"] == "classification" and not r["tagged"]]
            if untagged:
                out.append(self._finding(
                    "SEC-041", "security", "Detected sensitive columns not tagged", Severity.MEDIUM,
                    f"{len(untagged)} HIGH-confidence detections without a tag",
                    {"untagged": len(untagged), "by_class": _count(untagged, "tag_key"),
                     "sample": [fq(r) for r in untagged[:_SAMPLE]]},
                    "Review the detections and enable automatic tagging on the catalog, so tag-based ABAC "
                    "policies cover them.",
                    ["DBX-SBP:DATA-1"]))

        heur = [r for r in cols if r["source"] == "name_heuristic"]
        if heur:
            out.append(self._finding(
                "SEC-042", "security", "Columns that look sensitive by name are not classified", Severity.LOW,
                f"{len(heur)} candidate columns (name heuristic)",
                {"candidates": len(heur), "by_hint": _count(heur, "tag_key"),
                 "sample": [fq(r) for r in heur[:_SAMPLE]],
                 "note": "Heuristic on column names only — confirm with Data Classification before acting."},
                "Enable Data Classification on these catalogs, or tag the confirmed columns with a sensitivity tag.",
                ["DBX-SBP:DATA-1"]))

        if config:
            off = [c["catalog"] for c in config if c["enabled"] is False]
            if off:
                out.append(self._finding(
                    "GOV-036", "governance", "Catalogs without Data Classification", Severity.LOW,
                    f"{len(off)} of {len(config)} managed catalogs",
                    {"not_enabled": len(off), "managed_catalogs": len(config), "sample": off[:_SAMPLE]},
                    "Enable Data Classification on catalogs that hold business data (scan compute is billed "
                    "under the DATA_CLASSIFICATION billing origin; the first scan costs the most).",
                    ["DBX-SBP:DATA-1"]))
        return out


def _count(rows: list[dict], key: str) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for r in rows:
        out[str(r.get(key) or "")] += 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1])[:12])


def evaluate_protection(tagged: list[dict], masks: list[dict], abac: Optional[list[dict]],
                        detections: Optional[list[dict]], candidates: list[dict]) -> dict[str, Any]:
    """Pure join of sensitive columns × protections → per-column rows + metrics."""
    masked = {_fq(m): str(m.get("mask_name") or "") for m in masks}

    def abac_for(c: str, s: str, t: str, k: str, v: str) -> str:
        for a in abac or []:
            if str(a.get("k") or "") != k or str(a.get("c") or "") != c:
                continue
            if a.get("s") not in (None, "") and str(a["s"]) != s:
                continue
            if a.get("t") not in (None, "") and str(a["t"]) not in (t, f"{c}.{s}.{t}"):
                continue
            if a.get("v") not in (None, "") and str(a["v"]) != v:
                continue
            return str(a.get("policy_name") or "")
        return ""

    cols: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for r in tagged:
        v = str(r.get("v") or "")
        if v.strip().lower() in _NEGATIVE_VALUES:
            continue
        key = _fq(r)
        cols.setdefault(key, {"source": "tag", "tag_key": str(r.get("k")), "tag_value": v, "tagged": True})
    tag_keys = {_fq(r) for r in tagged}
    for d in detections or []:
        key = _fq(d)
        if key not in cols:
            cols[key] = {"source": "classification", "tag_key": str(d.get("k")), "tag_value": "",
                         "tagged": key in tag_keys}
    for n in candidates:
        key = _fq(n)
        if key not in cols and key not in tag_keys:
            cols[key] = {"source": "name_heuristic", "tag_key": str(n.get("hint") or ""), "tag_value": "",
                         "tagged": False}

    rows: list[dict[str, Any]] = []
    for (c, s, t, col), info in cols.items():
        if (c, s, t, col) in masked:
            protection, by = "direct_mask", masked[(c, s, t, col)]
        else:
            pol = abac_for(c, s, t, info["tag_key"], info["tag_value"]) if info["source"] == "tag" else ""
            protection, by = ("abac_policy", pol) if pol else ("none", "")
        if info["source"] == "name_heuristic" and protection != "none":
            continue  # a masked candidate is already handled
        rows.append({"catalog": c, "schema": s, "table": t, "column": col, "source": info["source"],
                     "tag_key": info["tag_key"], "tag_value": info["tag_value"], "tagged": info["tagged"],
                     "protection": protection, "protected_by": by})
    order = {"tag": 0, "classification": 1, "name_heuristic": 2}
    rows.sort(key=lambda r: (order[r["source"]], r["protection"] != "none", r["catalog"], r["table"], r["column"]))

    def n(pred: Callable[[dict], bool]) -> float:
        return float(sum(1 for r in rows if pred(r)))

    sens = lambda r: r["source"] in ("tag", "classification")  # noqa: E731
    metrics = [
        {"metric": "protection_sensitive_columns", "value": n(sens), "detail": "tagged or detected (HIGH)"},
        {"metric": "protection_direct_mask", "value": n(lambda r: sens(r) and r["protection"] == "direct_mask"), "detail": ""},
        {"metric": "protection_abac", "value": n(lambda r: sens(r) and r["protection"] == "abac_policy"), "detail": ""},
        {"metric": "protection_unprotected", "value": n(lambda r: sens(r) and r["protection"] == "none"), "detail": ""},
        {"metric": "protection_name_candidates", "value": n(lambda r: r["source"] == "name_heuristic"),
         "detail": "name heuristic, unmasked, untagged"},
        {"metric": "protection_masks_total", "value": float(len(masks)), "detail": "direct column masks"},
        {"metric": "protection_abac_visible", "value": float(len({a.get("policy_name") for a in (abac or [])})),
         "detail": "" if abac is not None else "not readable"},
        {"metric": "protection_detections_readable", "value": 1.0 if detections is not None else 0.0,
         "detail": "system.data_classification.results"},
    ]
    return {"columns": rows, "metrics": metrics}
