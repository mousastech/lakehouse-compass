"""Metadata Readiness — one usage-weighted index for the metadata estate (P6).

Replaces "share of tables with any comment" with a per-table score weighted by
how many people actually read the table (30-day lineage), so 300 untouched
staging tables don't outweigh the gold table 40 analysts query:

    table = 0.35 · documentation   useful descriptions (LLM verdict where reviewed,
                                   else the N1 heuristic class)
          + 0.25 · sensitivity     share of sensitive / likely-sensitive columns
                                   that are resolved (tagged and protected)
          + 0.20 · ownership       owner tag (½) + domain tag (½)
          + 0.20 · curation        layer tag (½) + certified (½)

    index = Σ weight(t) · table(t) / Σ weight(t),   weight = 1 + ln(1 + readers₃₀d)

The legacy Semantic Readiness (table comment coverage) stays as a sub-metric so
scan history remains comparable.
"""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Any

from .tag_profile import TagProfile

WEIGHTS = {"documentation": 0.35, "sensitivity": 0.25, "ownership": 0.20, "curation": 0.20}
# LLM verdict → documentation credit for a reviewed column.
VERDICT_CREDIT = {"good": 1.0, "weak": 0.5, "poor": 0.0}


def _key(c: Any, s: Any, t: Any) -> tuple[str, str, str]:
    return (str(c), str(s), str(t))


def table_scores(profile: TagProfile, facts: list[dict[str, Any]], sensitive_rows: list[dict[str, Any]],
                 reviews: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-table component scores (0–1) and usage weight."""
    # LLM reviews per table: credit by verdict, only for the columns reviewed.
    rev: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    for r in reviews:
        credit = VERDICT_CREDIT.get(str(r.get("verdict") or "").lower())
        if credit is not None:
            rev[_key(r.get("catalog"), r.get("schema"), r.get("table"))].append(credit)

    sens_total: dict[tuple[str, str, str], int] = defaultdict(int)
    sens_open: dict[tuple[str, str, str], int] = defaultdict(int)
    for r in sensitive_rows:
        k = _key(r.get("catalog"), r.get("schema"), r.get("table"))
        sens_total[k] += 1
        # resolved = known sensitive AND protected; heuristic candidates are open by definition
        if r.get("source") == "name_heuristic" or r.get("protection") == "none":
            sens_open[k] += 1

    out = []
    for f in facts:
        k = _key(f.get("c"), f.get("s"), f.get("n"))
        cols = int(f.get("col_total") or 0)
        useful = int(f.get("col_useful") or 0)
        documented = cols - int(f.get("col_missing") or 0)
        if k in rev and documented:
            # Reviewed columns earn their LLM credit; the documented columns not yet
            # reviewed keep the heuristic's useful share. Missing ones earn nothing.
            reviewed = min(len(rev[k]), documented)
            rest = (documented - reviewed) * (useful / documented)
            col_doc = (sum(rev[k][:reviewed]) + rest) / cols
        else:
            col_doc = useful / cols if cols else 0.0
        doc = 0.5 * (1.0 if f.get("table_q") == "useful" else 0.0) + 0.5 * min(1.0, col_doc)
        sens = 1.0 - (sens_open[k] / sens_total[k]) if sens_total[k] else 1.0
        own = 0.5 * bool(f.get("owner")) + 0.5 * bool(f.get("domain"))
        cert = str(f.get("cert") or "").lower() in profile.certified_values
        cur = 0.5 * bool(f.get("layer")) + 0.5 * cert
        score = (WEIGHTS["documentation"] * doc + WEIGHTS["sensitivity"] * sens
                 + WEIGHTS["ownership"] * own + WEIGHTS["curation"] * cur)
        out.append({"catalog": k[0], "schema": k[1], "table": k[2], "domain": f.get("domain") or "",
                    "weight": 1.0 + math.log1p(int(f.get("readers") or 0)), "readers": int(f.get("readers") or 0),
                    "documentation": doc, "sensitivity": sens, "ownership": own, "curation": cur, "score": score})
    return out


def readiness_index(rows: list[dict[str, Any]]) -> dict[str, float]:
    """Usage-weighted index (0–100) and each component, plus the unweighted index."""
    if not rows:
        return {"index": 0.0, "unweighted": 0.0, **{c: 0.0 for c in WEIGHTS}}
    wsum = sum(r["weight"] for r in rows)
    res = {"index": round(100.0 * sum(r["weight"] * r["score"] for r in rows) / wsum, 1),
           "unweighted": round(100.0 * sum(r["score"] for r in rows) / len(rows), 1)}
    for c in WEIGHTS:
        res[c] = round(100.0 * sum(r["weight"] * r[c] for r in rows) / wsum, 1)
    return res


def readiness_metrics(profile: TagProfile, facts: list[dict[str, Any]], sensitive_rows: list[dict[str, Any]],
                      reviews: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """governance_metrics rows (index + components) and per-domain index rows."""
    rows = table_scores(profile, facts, sensitive_rows, reviews)
    idx = readiness_index(rows)
    metrics = [
        {"metric": "metadata_readiness", "value": idx["index"],
         "detail": f"usage-weighted over {len(rows)} tables; {len(reviews)} LLM-reviewed columns"},
        {"metric": "metadata_readiness_unweighted", "value": idx["unweighted"], "detail": ""},
        *({"metric": f"mr_{c}", "value": idx[c], "detail": str(WEIGHTS[c])} for c in WEIGHTS),
    ]
    by_domain: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_domain[r["domain"]].append(r)
    domains = [{"domain": d, "tables": len(rs), **readiness_index(rs)} for d, rs in by_domain.items()]
    domains.sort(key=lambda d: (d["domain"] == "", -d["tables"]))
    return metrics, domains
