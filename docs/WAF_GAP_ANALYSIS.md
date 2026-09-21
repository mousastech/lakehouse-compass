# WAF Gap Analysis — Lakehouse Compass rule coverage

> Comparison of the Compass rule set against the **Databricks Well-Architected
> Framework (WAF)** — the seven pillars documented at
> `docs.databricks.com/.../lakehouse-architecture/well-architected` (mirrored
> internally at `go/waf`). Purpose: track which WAF best practices Compass
> already evaluates and which are still to be implemented.
>
> Snapshot: **2026-09-15** · Phase 0 · **21 real rules** (spec target ~150).
> Each rule now carries a `waf_pillars` field (see `models/rule.py`,
> `RuleRegistry.by_waf_pillar`). This doc is the roadmap companion to
> [`../DECISIONS.md`](../DECISIONS.md) **D2** (WAF integration deferred).

## Coverage scorecard

| WAF pillar | Compass rules | Rules | State |
|---|---|---|---|
| Cost Optimization | AIG-003, FIN-027/028/029/030, LKB-003 | 6 | 🟡 Partial (best covered) |
| Data & AI Governance | AIG-003/004, GEN-001/013, GOV-016/025, SEC-014/027/030 | 9¹ | 🟠 Thin |
| Security, Privacy & Compliance | AIG-004, AIG-014, LKB-001/002, SEC-014/027/029/030 | 8¹ | 🟠 Thin |
| Operational Excellence | AIG-014, REL-001, USG-010 | 3¹ | 🔴 Cross-cutting only — no dedicated pack |
| Reliability | REL-001 | 1 | 🔴 Almost none |
| Performance Efficiency | PERF-010 | 1 | 🔴 Almost none |
| Interoperability & Usability | GEN-001, GOV-025 | 2¹ | ⚫ Effectively none |

¹ Counts overlap: several rules map to more than one pillar (e.g. SEC-027 →
security + governance). There are 21 distinct rules.

**Headline findings**
1. **Two WAF pillars have no dedicated domain or rules** — Operational Excellence
   and Interoperability & Usability are touched only by cross-cutting rules.
2. Where covered, coverage is 1–6 rules against **dozens** of best practices per
   pillar. Reliability and Performance Efficiency have a single signal each.
3. The nine Compass domains do **not** map 1:1 to the seven WAF pillars; the
   `waf_pillars` field (added 2026-09-15) is what makes per-pillar scoring
   possible. Wiring it into domain/overall scoring is still to do.

## Gaps by pillar (what to implement next)

### 🔴 Operational Excellence — no dedicated pack
Not evaluated: dev/staging/prod **environment isolation**; **CI/CD & MLOps**
standardization; **IaC / Terraform / DABs**; Git-folder source control; catalog
strategy with environment-aware bindings; Lakeflow Jobs orchestration & Auto
Loader; service-limit / quota management & capacity planning; and the whole
**monitoring/alerting/logging** block — SQL Alerts, job/pipeline/streaming/Spark
monitoring, system-table dashboards, Lakehouse Monitoring for data quality.

### ⚫ Interoperability & Usability — effectively none
Not evaluated: open-format adoption (**Delta, Iceberg/UniForm, Delta Sharing,
D2D sharing**); **Lakehouse Federation**; MLflow standards; self-service
provisioning & compute templates (T-shirt sizing); **data-as-products** &
semantic consistency; Catalog Explorer / column-level lineage adoption for
discovery. (GEN-001/GOV-025 touch usability of Genie & metadata only.)

### 🔴 Reliability — only REL-001 (job failure rate)
Missing: job **retry/timeout** policies; **medallion** + schema
enforcement/expectations; streaming **checkpoints**; **time travel / RESTORE**
recovery; job **repair runs**; multi-AZ high availability; and the big one —
**DR with defined & tested RTO/RPO** (metadata + table replication).

### 🔴 Performance Efficiency — only PERF-010 (query latency)
Missing: serverless adoption; **Predictive Optimization** enabled; **liquid
clustering** vs over-partitioning; OPTIMIZE / auto-compaction / optimized writes;
data skipping; `ANALYZE` statistics; Photon; disk caching; native Spark ops vs
Python/Scala UDFs; query profiling.

### 🟠 Security, Privacy & Compliance — identity/privilege base only
Covered: SP over-privilege (SEC-027), broad all-users grants (SEC-014), PAT vs
OAuth (SEC-029), ABAC tagging (SEC-030), Lakebase auth (LKB-001/002), endpoint
guardrails (AIG-004).
Missing: **SSO / SCIM / MFA**; account-admin count (2–3) & duty segregation;
**compute policies**; **verbose audit logging enabled**; network controls
(**PrivateLink, SCC, customer-managed VPC, IP access lists**, serverless
firewall); no prod data in DBFS; **CMK / encryption at rest**; Enhanced Security
Monitoring / Compliance Profile; Clean Rooms; exfiltration prevention.

### 🟠 Data & AI Governance — metadata + tags + Genie context
Covered: table descriptions (GOV-025), governed tags applied (GOV-016), Genie
agent quality (GEN-001/013), plus the security-side governance rules.
Missing: **data & model lineage**; **row filters / column masks**; audit-log
configuration & access/sharing auditing; metastore/catalog/schema design
(medallion); and the whole **data-quality** block (expectations, profiling, data
dictionary, quality monitoring).

### 🟡 Cost Optimization — attribution + spend caps + scale-to-zero
Covered: spend attribution (FIN-027/030), endpoint spend caps (FIN-028/AIG-003),
Lakebase idle / scale-to-zero (FIN-029/LKB-003).
Missing the classic compute levers: **all-purpose vs jobs compute**;
**auto-termination**; autoscaling; cluster pools; **Photon**; current runtimes;
**spot / fleet instances**; triggered streaming (`AvailableNow`); account-level
budgets; tag-housekeeping jobs.

## Evolving toward `databricks-solutions/databricks-waf`

The official WAF assessment app (`databricks-solutions/databricks-waf`) is a
richer, control-catalogue-driven assessment: **165 scored controls across 7
pillars / 31 principles** as validated YAML (provenance, measurability,
severity, pass criteria + thresholds, multi-format remediation, attestation),
severity-weighted **mean-of-means scoring with a low/high confidence range**, an
improvement-plan workflow and immutable audit. Its source is under a proprietary
Databricks license, so — as with Genie Readiness — Compass **ports the
methodology and re-derives content from the public WAF docs**, it does not copy
their code. Compass stays one integrated app (D2); we evolve the WAF module,
not replace it with a second app.

- **✅ Phase 1 (2026-09-21): confidence-range scoring.** The `/waf` page now shows,
  per pillar, a **point score** (health of what Compass measures) bracketed by a
  **worst-case … best-case band** and a **confidence chip** (high/medium/low).
  Range: `low = score·frac`, `high = score·frac + (1−frac)·100`, where
  `frac = mapped rules / TARGET[pillar]` and TARGET (per-pillar breadth ≈ the
  165-control WAF catalogue) is defined in `app/client/src/pages/Waf.tsx`.
  Pillars sort weakest-worst-case first. Presentation-layer only — no schema
  change, no scan re-run.
- **✅ Phase 2 (2026-09-21): structured control catalogue + real denominators.**
  A WAF control catalogue lives in `packages/compass_core/waf/catalogue/*.yaml`
  (56 controls across all 7 pillars, incl. the two previously-empty ones), loaded by
  `packages/compass_core/waf/__init__.py` (`WafControl` + `assess()`). Each control
  carries provenance (waf-docs / security-guide), measurability (system_table /
  rest_api / attestation), severity, criteria, remediation + doc link, and an optional
  linked Compass rule id. The scan job assesses the catalogue against each scan's open
  findings + usable capabilities → per-control status (pass / gap / unmeasured /
  attestation), persisted to a new `waf_controls` table, plus real
  `controls_total / measured / passed / low / high` columns added to `waf_scores`
  (via mergeSchema — non-destructive, history preserved). The `/waf` page now uses the
  **real catalogue denominator** for the confidence band (Phase 1's TARGET remains only
  as a fallback for pre-catalogue scans) and adds a **per-pillar control drill-down**
  with status chips, remediation and doc links. Point score on `/waf` is now
  passed/measured (health of what's checked); the legacy penalty `score` column is kept
  untouched for the digest/report/agent.
- ⏭️ **Phase 3:** surface per-control remediation in the agent; add SQL/CLI remediation snippets.
- ⏭️ **Phase 4:** attestation questionnaire (Lakebase-backed) for controls telemetry can't cover.

## Recommended roadmap

1. **✅ Done (2026-09-15):** add `waf_pillars` to the rule schema + registry
   lookup + tag all 21 existing rules. Unblocks per-pillar scoring.
2. **✅ Done (2026-09-15):** per-pillar scoring wired end-to-end — findings carry
   `waf_pillars` (persisted to the `findings` Delta table), `scoring.score_waf_pillars`
   computes a score + coverage (mapped-rule count) per pillar, the scan job writes a
   `waf_scores` table, and the app has a **Well-Architected** page (`/waf`) that ranks
   pillars weakest-first and flags pillars with limited rule coverage.
3. **Fill the two empty pillars** with new packs: an **Operational Excellence**
   domain (environments, CI/CD, monitoring/alerting) and **Interoperability &
   Usability** coverage (open formats, federation, lineage/discovery).
4. **Deepen Reliability & Performance** (1 rule each) — prioritize **DR
   RTO/RPO**, **Predictive Optimization**, **liquid clustering / OPTIMIZE**.
5. Backfill the remaining Security & Governance best practices (SSO/SCIM/MFA,
   verbose audit logs, network controls; lineage, row/column masks, data quality)
   toward the ~150-rule target.

> **Source caveat:** built from the public WAF docs; the internal `go/waf`
> Confluence page (`UN/2867987361`) could not be read in-session (Confluence &
> Glean MCP were down). Reconcile against any AT&T/internal custom controls when
> those tools are available.
