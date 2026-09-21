"""Lakehouse Compass — premium PDF diagnostic report (serverless Lakeflow job).

Renders a branded consulting-grade PDF for a given workspace_id + scan_id using
the snapshot indices AT GENERATION TIME (scan_runs), top findings with evidence
and remediation, compliance coverage, and a "what changed since last scan" diff.
Writes the PDF to the reports UC Volume and appends a checkup_reports row.

Serverless allows pip: WeasyPrint + markdown are declared in the job environment.
"""

from __future__ import annotations

import argparse
import glob
import html as _html
import json
import os
import sys
from datetime import datetime, timezone


def _bootstrap_path() -> None:
    candidates: list[str] = []
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        candidates += [os.path.join(here, "..", "..", "packages")]
    except NameError:
        pass
    candidates += glob.glob("/Workspace/Users/*/.bundle/lakehouse-compass/*/files/packages")
    candidates += glob.glob("/Workspace/**/lakehouse-compass/*/files/packages", recursive=True)
    for c in candidates:
        if c and os.path.isdir(os.path.join(c, "compass_core")):
            sys.path.insert(0, os.path.abspath(c))
            return


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--catalog", default="moi_ai_catalog")
    p.add_argument("--schema", default="lakehouse_compass")
    p.add_argument("--volume", default="reports")
    p.add_argument("--workspace_id", default="")
    p.add_argument("--scan_id", default="")  # empty = latest for workspace
    known, _ = p.parse_known_args()
    return known


def _spark():
    from pyspark.sql import SparkSession  # type: ignore

    return SparkSession.builder.getOrCreate()


def _rows(spark, q):
    return [r.asDict(recursive=True) for r in spark.sql(q).collect()]


def esc(v) -> str:
    return _html.escape(str(v if v is not None else ""))


CSS = """
@page { size: A4; margin: 20mm 16mm 18mm; @bottom-center { content: "Lakehouse Compass · confidential — framework mappings are advisory, not a certification"; font-family: Barlow, Arial, sans-serif; font-size: 7pt; color: #5B6B73; } @bottom-right { content: counter(page) " / " counter(pages); font-family: Barlow, Arial, sans-serif; font-size: 7.5pt; color: #5B6B73; } }
:root { --lava:#FF3621; --lava-dk:#C4260F; --navy:#1B3139; --teal:#1B5161; --ink:#1B2A32; --muted:#5B6B73; }
* { box-sizing: border-box; }
body { font-family: Barlow, Arial, sans-serif; color: var(--ink); font-size: 10pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; }
.cover { page-break-after: always; padding-top: 28mm; }
.cover .eyebrow { color: var(--lava); font-weight: 700; font-size: 10pt; letter-spacing: .18em; text-transform: uppercase; }
.cover h1 { font-size: 34pt; line-height: 1.06; font-weight: 800; color: var(--navy); margin: 6mm 0 4mm; letter-spacing: -.01em; }
.cover .sub { color: var(--muted); font-size: 12pt; max-width: 150mm; }
.accent { width: 52mm; height: 6pt; background: var(--lava); margin: 9mm 0; }
.meta { margin-top: 14mm; font-size: 10pt; color: var(--ink); }
.meta div { margin-bottom: 2mm; }
.meta b { color: var(--navy); }
.conf { display: inline-block; margin-top: 8mm; font-size: 8pt; font-weight: 700; color: var(--lava); border: 1pt solid var(--lava); padding: 3px 10px; border-radius: 3px; letter-spacing: .08em; }
h2 { font-size: 15pt; color: var(--navy); font-weight: 800; margin: 9mm 0 3mm; break-after: avoid; padding-bottom: 2mm; border-bottom: 1.5pt solid var(--lava); }
h2 .n { color: var(--lava); margin-right: 7px; }
.lead { font-size: 10pt; color: var(--muted); border-left: 3pt solid var(--lava); padding: 1mm 0 1mm 5mm; margin: 3mm 0 5mm; }
.kpirow { display: flex; gap: 4mm; margin: 4mm 0; }
.kpi { flex: 1; border: 1pt solid #E3E8EA; border-top: 3pt solid var(--lava); border-radius: 4px; padding: 4mm; }
.kpi .n { font-size: 20pt; font-weight: 800; color: var(--lava-dk); }
.kpi .l { font-size: 7.6pt; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
table { width: 100%; border-collapse: collapse; margin: 3mm 0 5mm; font-size: 8.6pt; }
th { background: var(--navy); color: #fff; text-align: left; padding: 2.4mm 3mm; font-weight: 600; font-size: 8.2pt; }
td { padding: 2.2mm 3mm; border-bottom: .6pt solid #E3E8EA; vertical-align: top; }
tr { break-inside: avoid; }
.sev { font-weight: 700; text-transform: uppercase; font-size: 7.6pt; }
.sev.critical { color: #C4260F; } .sev.high { color: #E06A1B; } .sev.medium { color: #B08600; } .sev.low { color: #1B5161; }
.pill { display: inline-block; padding: 1px 6px; border-radius: 3px; background: #F2F5F6; color: var(--teal); font-size: 7.4pt; margin: 0 2px 2px 0; }
.chg-new { color: #C4260F; font-weight: 700; } .chg-res { color: #1B7A43; font-weight: 700; } .chg-reg { color: #E06A1B; font-weight: 700; }
.small { font-size: 8pt; color: var(--muted); }
.digest { background: #F7FAFB; border: 1pt solid #E3E8EA; border-left: 4pt solid var(--lava); border-radius: 4px; padding: 5mm; margin: 4mm 0 5mm; font-size: 9.4pt; line-height: 1.55; }
.digest .hl { font-weight: 700; color: var(--navy); text-transform: uppercase; letter-spacing: .06em; font-size: 8pt; }
"""


def build_html(ctx: dict) -> str:
    snap = ctx["snapshot"]
    findings = ctx["findings"]
    compliance = ctx["compliance"]
    diff = ctx["diff"]
    domains = ctx["domains"]
    digest = ctx.get("digest", {})
    digest_text = ctx.get("digest_text", "")

    from compass_core.digest import PILLAR_LABELS

    weak_pills = "".join(
        f"<span class=pill>{esc(PILLAR_LABELS.get(p['pillar'], p['pillar']))}: {esc(p['score'])}</span>"
        for p in digest.get("weakest_pillars", [])
    )
    digest_block = (
        f"<div class='digest'><div class='hl'>Digest — plain-language status</div>"
        f"<p>{'<br>'.join(esc(line) for line in digest_text.split(chr(10)))}</p>"
        + (f"<p class='small'><b>Weakest pillars:</b> {weak_pills}</p>" if weak_pills else "")
        + "</div>"
        if digest_text else ""
    )

    dom_rows = "".join(
        f"<tr><td>{esc(d['domain'])}</td><td>{esc(d['weight'])}</td>"
        f"<td>{esc(round(d['score'],1))}</td><td>{esc(d['findings'])}</td><td>{esc(d['critical_findings'])}</td></tr>"
        for d in domains
    )
    find_rows = "".join(
        f"<tr><td>{esc(f['rule_id'])}</td><td class='sev {esc(f['severity'])}'>{esc(f['severity'])}</td>"
        f"<td>{esc(f['title'])}<div class='small'>{esc(f['resource'])}</div>"
        f"<div class='small'><b>Remediation:</b> {esc(f.get('remediation') or '—')}</div>"
        f"<div>{''.join(f'<span class=pill>{esc(c)}</span>' for c in (f.get('framework_controls') or []))}</div></td></tr>"
        for f in findings
    )
    comp_rows = "".join(
        f"<tr><td>{esc(c['control_id'])}</td><td>{esc(c['title'])}</td><td>{esc(c['category'])}</td><td>{esc(c['status'])}</td></tr>"
        for c in compliance
    )

    def chg_list(items, cls, label):
        if not items:
            return f"<p class='small'>No {label.lower()} findings.</p>"
        return "<ul>" + "".join(f"<li class='{cls}'>{esc(i)}</li>" for i in items) + "</ul>"

    changed = (
        f"<div class='kpirow'>"
        f"<div class='kpi'><div class='n chg-new'>{len(diff['new'])}</div><div class='l'>New</div></div>"
        f"<div class='kpi'><div class='n chg-res'>{len(diff['resolved'])}</div><div class='l'>Resolved</div></div>"
        f"<div class='kpi'><div class='n chg-reg'>{len(diff['regressed'])}</div><div class='l'>Still open</div></div>"
        f"</div>"
        f"<p class='small'><b>New:</b> {', '.join(esc(x) for x in diff['new']) or '—'}<br>"
        f"<b>Resolved:</b> {', '.join(esc(x) for x in diff['resolved']) or '—'}</p>"
    )

    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>
<section class="cover">
  <div class="eyebrow">Lakehouse Compass · Platform Diagnostic</div>
  <h1>Databricks Platform<br>Check-up Report</h1>
  <div class="sub">Security, FinOps, AI Estate, Governance, Genie, Lakebase &amp; more — prioritized findings, compliance coverage and remediation.</div>
  <div class="accent"></div>
  <div class="meta">
    <div><b>Workspace:</b> {esc(snap['workspace_name'] or snap['workspace_id'])} <span class="small">({esc(snap['workspace_id'])})</span></div>
    <div><b>Scan ID:</b> {esc(snap['scan_id'])}</div>
    <div><b>Generated at:</b> {esc(snap['generated_at'])} UTC</div>
    <div><b>Overall health:</b> {esc(round(snap['overall_score'],1))} / 100 &nbsp;·&nbsp; <b>Coverage:</b> {esc(snap['coverage_pct'])}%</div>
  </div>
  <div class="conf">CONFIDENTIAL</div>
</section>

<h2><span class="n">01</span>Executive summary</h2>
<p class="lead">This report captures the platform's diagnostic indices at generation time. Scores reflect open findings weighted by domain; coverage reflects the share of checks that were measurable given available capabilities.</p>
<div class="kpirow">
  <div class="kpi"><div class="n">{esc(round(snap['overall_score'],1))}</div><div class="l">Overall / 100</div></div>
  <div class="kpi"><div class="n">{esc(snap['coverage_pct'])}%</div><div class="l">Rule coverage</div></div>
  <div class="kpi"><div class="n">{esc(snap['crit'])}</div><div class="l">Critical</div></div>
  <div class="kpi"><div class="n">{esc(snap['high'])}</div><div class="l">High</div></div>
  <div class="kpi"><div class="n">{esc(snap['total_findings'])}</div><div class="l">Total findings</div></div>
</div>
{digest_block}

<h2><span class="n">02</span>Domain scores (at generation time)</h2>
<table><thead><tr><th>Domain</th><th>Weight</th><th>Score</th><th>Findings</th><th>Critical</th></tr></thead><tbody>{dom_rows}</tbody></table>

<h2><span class="n">03</span>Top findings</h2>
<table><thead><tr><th>Rule</th><th>Severity</th><th>Finding · resource · remediation · controls</th></tr></thead><tbody>{find_rows or '<tr><td colspan=3 class=small>No open findings.</td></tr>'}</tbody></table>

<h2><span class="n">04</span>Compliance coverage — dbx-security-best-practices</h2>
<table><thead><tr><th>Control</th><th>Title</th><th>Category</th><th>Status</th></tr></thead><tbody>{comp_rows}</tbody></table>

<h2><span class="n">05</span>What changed since last scan</h2>
{changed}
</body></html>"""


def main() -> None:
    args = parse_args()
    _bootstrap_path()
    spark = _spark()
    fq = f"{args.catalog}.{args.schema}"
    ws = args.workspace_id

    ws_filter = f"workspace_id = '{ws}'" if ws else "1=1"
    scan_id = args.scan_id
    if not scan_id:
        r = _rows(spark, f"SELECT MAX(scan_id) s FROM {fq}.scan_runs WHERE {ws_filter}")
        scan_id = r[0]["s"] if r and r[0]["s"] else ""
    if not scan_id:
        raise SystemExit("No scan_runs snapshot found; run the scan first.")

    snap_rows = _rows(spark, f"SELECT * FROM {fq}.scan_runs WHERE scan_id='{scan_id}' AND {ws_filter} LIMIT 1")
    if not snap_rows:
        raise SystemExit(f"No snapshot for scan_id={scan_id}")
    snap = snap_rows[0]
    ws = snap["workspace_id"]

    domains = _rows(spark, f"SELECT domain, weight, score, findings, critical_findings FROM {fq}.scores "
                           f"WHERE scan_id='{scan_id}' AND workspace_id='{ws}' AND is_overall=false "
                           f"ORDER BY weight DESC")
    findings = _rows(spark, f"SELECT rule_id, severity, title, resource, remediation, framework_controls "
                            f"FROM {fq}.findings WHERE scan_id='{scan_id}' AND workspace_id='{ws}' "
                            f"ORDER BY CASE severity WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END DESC")
    compliance = _rows(spark, f"SELECT control_id, title, category, status FROM {fq}.compliance_results "
                              f"WHERE scan_id='{scan_id}' AND workspace_id='{ws}'")

    # diff vs previous scan for this workspace
    prev = _rows(spark, f"SELECT scan_id FROM {fq}.scan_runs WHERE workspace_id='{ws}' AND scan_id < '{scan_id}' "
                        f"ORDER BY scan_id DESC LIMIT 1")
    cur_ids = {f["rule_id"] for f in findings}
    if prev:
        prev_scan = prev[0]["scan_id"]
        prev_ids = {r["rule_id"] for r in _rows(spark, f"SELECT DISTINCT rule_id FROM {fq}.findings WHERE scan_id='{prev_scan}' AND workspace_id='{ws}'")}
    else:
        prev_ids = set()
    diff = {
        "new": sorted(cur_ids - prev_ids),
        "resolved": sorted(prev_ids - cur_ids),
        "regressed": sorted(cur_ids & prev_ids),
    }

    # Executive digest (plain-language) — same engine as the digest job.
    from compass_core.digest import build_digest, narrative as digest_narrative

    waf_pillars = _rows(spark, f"SELECT pillar, score, findings, critical_findings, rules FROM {fq}.waf_scores "
                               f"WHERE scan_id='{scan_id}' AND workspace_id='{ws}'")
    prev_run = None
    if prev:
        pr = _rows(spark, f"SELECT * FROM {fq}.scan_runs WHERE scan_id='{prev[0]['scan_id']}' AND workspace_id='{ws}' LIMIT 1")
        prev_run = pr[0] if pr else None
    criticals = [{"rule_id": f["rule_id"], "title": f["title"], "resource": f["resource"]}
                 for f in findings if f["severity"] == "critical"]
    digest = build_digest(workspace_name=snap.get("workspace_name") or "", current=snap, previous=prev_run,
                          waf_pillars=waf_pillars, current_rule_ids=cur_ids, previous_rule_ids=prev_ids,
                          criticals=criticals)
    digest_text = digest_narrative(digest)

    ctx = {"snapshot": snap, "domains": domains, "findings": findings, "compliance": compliance,
           "diff": diff, "digest": digest, "digest_text": digest_text}
    html_doc = build_html(ctx)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    fname = f"compass_{ws}_{scan_id}_{ts}.pdf"
    vol_dir = f"/Volumes/{args.catalog}/{args.schema}/{args.volume}"
    os.makedirs(vol_dir, exist_ok=True)
    vol_path = f"{vol_dir}/{fname}"

    try:
        from weasyprint import HTML  # type: ignore

        HTML(string=html_doc).write_pdf(vol_path)
        rendered = "pdf"
    except Exception as e:
        # Fallback: still deliver the report as HTML so the run is not lost.
        vol_path = vol_path[:-4] + ".html"
        with open(vol_path, "w", encoding="utf-8") as fh:
            fh.write(html_doc)
        rendered = f"html (weasyprint unavailable: {str(e)[:160]})"

    now = datetime.now(timezone.utc).isoformat()
    met = sum(1 for c in compliance if c["status"] == "MET")
    not_met = sum(1 for c in compliance if c["status"] == "NOT_MET")
    from pyspark.sql.types import (
        DoubleType, LongType, StringType, StructField, StructType,
    )

    schema = StructType([
        StructField("report_id", StringType()), StructField("scan_id", StringType()),
        StructField("workspace_id", StringType()), StructField("workspace_name", StringType()),
        StructField("generated_at", StringType()), StructField("overall_score", DoubleType()),
        StructField("coverage_pct", DoubleType()), StructField("crit", LongType()),
        StructField("high", LongType()), StructField("med", LongType()), StructField("low", LongType()),
        StructField("framework", StringType()), StructField("met", LongType()),
        StructField("not_met", LongType()), StructField("rendered", StringType()),
        StructField("volume_path", StringType()),
    ])
    row = {
        "report_id": f"rpt-{ts}", "scan_id": scan_id, "workspace_id": ws,
        "workspace_name": snap.get("workspace_name") or "", "generated_at": now,
        "overall_score": float(snap["overall_score"]), "coverage_pct": float(snap["coverage_pct"]),
        "crit": int(snap["crit"]), "high": int(snap["high"]), "med": int(snap["med"]), "low": int(snap["low"]),
        "framework": "dbx-security-best-practices", "met": met, "not_met": not_met,
        "rendered": rendered, "volume_path": vol_path,
    }
    spark.createDataFrame([row], schema=schema).write.mode("append").option("mergeSchema", "true").saveAsTable(f"{fq}.checkup_reports")

    print(f"[compass] report ({rendered}) -> {vol_path}")
    print(f"[compass] checkup_reports row: scan_id={scan_id} ws={ws} score={snap['overall_score']} diff_new={len(diff['new'])} resolved={len(diff['resolved'])}")


if __name__ == "__main__":
    main()
