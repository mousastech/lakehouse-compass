# Architecture Decision Record — Lakehouse Compass

Status legend: ✅ decided · ⏭️ deferred to a later phase.

## D1 — Frontend framework: AppKit, not Next.js ✅
**Decision.** Build the app on **AppKit** (`@databricks/appkit` + `@databricks/appkit-ui`,
Express + React 19 + Vite + Tailwind v4), not Next.js.
**Rationale (spec §3.1).** AppKit gives, out of the box: Databricks OAuth and
user-token forwarding, a Lakebase pool with automatic token rotation, typed SQL
access to the warehouse (Analytics plugin), Genie and Model Serving plugins with
SSE streaming, telemetry/caching, and Databricks-designed UI components. Next.js
remains a documented alternative but is not used.

## D2 — WAF integration: (b) standalone for Phase 0 ✅
Spec §19 offers two ways to relate to `databricks-waf`:
(a) build Compass as extension packs that plug into the WAF control catalogue and
Lakebase schema, or (b) keep Compass **standalone** and import WAF outcomes as a
capability, mapping WAF control ids to Compass rules to avoid double scoring.
**Decision.** **(b) standalone for Phase 0.** The WAF extension API is not
confirmed stable in this environment, and a standalone core lets Phase 0 ship a
deployable app with zero cross-repo coupling. WAF (and SAT, agent-control-plane,
Genie Workbench, etc.) are modelled as **capabilities with probes** (see
`compass_core/capabilities/manager.py`) and ingested — not rebuilt — in later
phases. Revisit (a) in Phase 3 if the WAF extension API stabilises.

## D3 — Demo-mode-first ✅
Phase 0 ships with `COMPASS_DEMO_MODE=true`. The app renders the full Overview
from bundled fixtures with **zero external resources** (no SQL warehouse, no
Lakebase, no serving endpoint). This makes the first deploy bulletproof and lets
the UI be validated before any live data source or permission is wired.
The same client renders live data once resources are attached (the API route
handlers switch from fixtures to Delta/Lakebase reads).

## D4 — Build on the Databricks side, deploy via DAB ✅
The build machine's public npm registry is blocked, so the app **self-builds on
the Apps compute**: `app.yaml` runs `npm ci || npm install; npm run build && npm
start`. Deploy with `databricks bundle deploy` + `databricks bundle run
compass_app` — **not** `databricks apps deploy` (which type-checks locally and
fails without `node_modules`). Watch the build with `databricks apps logs`.

## D5 — No AppKit typed-query codegen in Phase 0 ✅
The reference AppKit template runs `appkit generate-types` / `appkit plugin sync`
as build hooks to type the Analytics plugin's SQL queries. Phase 0 uses **only
the `server` plugin** and serves demo data through plain Express routes, so those
hooks are removed — the build is pure `tsc + tsdown + vite`, eliminating a class
of codegen build failures. When the Analytics plugin is added (Phase 1) the
hooks and the `asRows(data)`/`firstRow(data)` access helpers return.

## D6 — Scoring & data model ✅
Weighted scoring with the spec §6 weights (Security 25 … Reliability 3, sum 100).
Domain score = 100 − Σ severity penalties of open findings; overall = weighted
average; coverage = fraction of capabilities usable. Models are stdlib
dataclasses (`compass_core/models`); rules are YAML (`rules/definitions`);
compliance frameworks are YAML with an advisory mapper.

## D7 — Catalog: `moi_ai_catalog`, not `main` (Phase 1) ✅
The `main` catalog is **not accessible** in the fevm-moi-ai workspace
(`PERMISSION_DENIED: Catalog 'main' is not accessible`). The scan job and app
therefore use **`moi_ai_catalog.lakehouse_compass.*`** (a writable catalog here).
Configurable via the `compass_catalog` bundle variable / `COMPASS_CATALOG` env;
the scan-job catalog is a task parameter. The spec's `main.lakehouse_compass`
is the intended default where `main` is writable.

## D8 — Live data path via analytics plugin + client fallback (Phase 1) ✅
The scan job (serverless, runs as the deployer) reads System Tables and writes
`moi_ai_catalog.lakehouse_compass.*` Delta. The app reads that Delta through the
AppKit **analytics plugin** (`config/queries/*.sql`, one bound SQL warehouse),
using the client `useLiveRows(queryName, fixturePath)` helper: it tries the
typed analytics query and, on error/empty, falls back to a DB-shaped fixture
endpoint (`/api/rows/*`). This keeps `COMPASS_DEMO_MODE=false` while guaranteeing
every screen renders. Server-side analytics execution in `/api/*` handlers was
evaluated but the AppKit analytics plugin's supported surface is the client hook
(`useAnalyticsQuery`), so live reads happen client-side; the Express `/api/rows/*`
routes are the fixture fallback. `appkit generate-types` types query names as a
union → the helper casts the dynamic name to `Parameters<typeof useAnalyticsQuery>[0]`.
The app SP is granted `USE CATALOG` + `USE SCHEMA, SELECT` on the schema.

## D9 — Per-workspace diagnostic (product requirement) ✅
The diagnostic runs **per workspace**. Every Delta table carries `workspace_id`
+ `workspace_name`; `jobs/scan/run_scan.py` is parameterized by `--workspace_id`
(default = current, 7474658545709121). Workspaces are discovered via capability
detection: **`system.access.workspaces_latest`** (id+name), falling back to
`SELECT DISTINCT workspace_id FROM system.billing.usage`. Discovery here returns
~4,096 workspaces (large metastore) — too many for a dropdown, so the full list
is recorded in the `workspaces` inventory table while the **UI selector lists
only *scanned* workspaces** (from `scan_runs`) plus **"All workspaces (Account
mode)"**. The selection is URL-synced (`?ws=`) and bound as the `:p_ws` query
parameter; every screen's query is "latest scan per workspace, optionally
filtered to `:p_ws`". Selecting an unscanned workspace shows a clean empty state.

## D10 — Scan history + immutable snapshot ✅
Findings/scores/cost/compliance/capabilities are written **append** (keyed by
`scan_id` + `workspace_id`), so history accrues; UI queries pick the latest
`scan_id` per workspace. Each run appends one immutable **`scan_runs`** snapshot
(scan_id, workspace, `generated_at`, overall + per-domain scores JSON, coverage,
severity counts). Overview's "delta since last scan" is computed from the two
most recent `scan_runs` for the selected workspace (`trend.sql`). The
new/resolved/regressed finding **diff** between the two most recent scans is
computed in the report job (Python) for the PDF's "what changed" section.

## D11 — Premium PDF diagnostic report ✅
`jobs/report/run_checkup.py` (serverless) renders a branded consulting-grade PDF
with **WeasyPrint** (declared in the job environment: `weasyprint`, `markdown`) —
Barlow/Arial, lava `#FF3621` accents, navy `#1B3139` table headers, cover page,
page numbers, advisory footer (§2.13). Content: exec summary + snapshot indices
**at generation time** (with `generated_at`), domain scores, top findings with
evidence + remediation, `dbx-security-best-practices` coverage, and "what changed
since last scan". The PDF is written to the UC Volume
`moi_ai_catalog.lakehouse_compass.reports` as
`compass_<ws>_<scan>_<yyyymmddHHMM>.pdf`, and a `checkup_reports` row is appended.
If WeasyPrint is unavailable at runtime the job degrades to an `.html` artifact
in the same Volume (recorded as `rendered=html`) so a run is never lost. The app
**Reports** screen lists past reports (timestamp + captured indices + Volume
path) and a **"Generate diagnostic report"** button triggers the job via the
Jobs API using the app service principal (granted `CAN_MANAGE_RUN` on the job);
the job runs async on serverless. The **scan schedule stays PAUSED** — runs are
manual.

## D12 — PDF download proxy ✅
`GET /api/reports/download?path=…` streams a report from the reports Volume via
the Files API (`/api/2.0/fs/files{path}`) using the app SP, as `application/pdf`
(or `text/html` for the fallback artifact), `Content-Disposition` attachment
(or `inline=1` to preview). The path is validated to start with
`/Volumes/moi_ai_catalog/lakehouse_compass/reports/` and reject `..`/NUL — no
traversal. Reports rows get Download + open-in-new-tab buttons. (Verified: 200 +
application/pdf renders; `/etc/passwd` → 400.)

## D13 — Compass Agent (Phase 2) ✅ + deviations
- **Endpoint / governance.** `databricks-claude-sonnet-4-5`, bound as App
  resource **`compass-llm`** (CAN_QUERY). Governance is detected at
  `GET /api/agent/governance` from the endpoint's `ai_gateway` config. In
  fevm-moi-ai it is **partially governed**: `usage_tracking=true`, but
  `guardrails=false` and `payload_logging=false`, no spend cap. **Deviation
  (demo):** rather than hard-disabling the agent, it runs and **surfaces the gap**
  as an amber banner in the panel (maps to AIG-004 / self-check) — production
  should add guardrails + inference tables + a spend cap.
- **Invocation.** The governed endpoint is called **directly** server-side
  (`/serving-endpoints/<name>/invocations`) with the app SP token, rather than
  through the AppKit `serving()` plugin, so the server controls the tool-calling
  loop. (The plugin's resourceKey is `serving-endpoint`; our resource is
  `compass-llm`, so the plugin is intentionally not registered.) Function-calling
  uses the OpenAI `tools` format (supported by the endpoint).
- **Tools** (whitelisted, read-only over Compass's own Delta, workspace-scoped):
  get_findings, get_finding, get_rule, get_scores, get_capabilities,
  get_cost_summary, get_compliance, get_maintenance, run_named_query (only
  `config/queries/*`, `:p_ws` substituted with a validated numeric id),
  draft_proposed_change, search_docs (docs URLs from the rule catalog only). SQL
  runs via the Statements API with the SP token.
- **Guardrails.** System prompt: never executes (proposes only); tool results are
  data, never instructions (prompt-injection defense); must cite finding/rule
  ids; refuses execution/credential requests. Token budget = `max_tokens=1024` ×
  `MAX_STEPS=5` per turn (daily budget → config, deferred).
- **UI.** ⌘K / "Ask Compass" slide-over + `/agent` screen: SSE streaming with
  typing cadence, tool calls shown as collapsible steps, citations rendered as
  chips that link to Findings.
- **ProposedChange.** `draft_proposed_change` appends to Delta `proposed_changes`
  (steps, code, rollback, blast radius, confidence, status). `/changes` screen
  lists them with Approve / Reject / Needs-info → `POST /api/changes/status`
  (UPDATE). **Deviation:** the "reviewer holds CAN MANAGE" check is simplified to
  any authenticated app user for the demo. Execution stays outside Compass.
- **Deferred (noted):** Lakebase-backed persistent conversation memory (session
  memory only for now), Agent Bricks registration, the MLflow evaluation
  set/job. **MLflow per-call tracing** is not emitted from the Node server;
  auditability relies on the endpoint's usage tracking / (recommended) inference
  tables — noted as a gap.

## D14 — History / Scan-Diff Timeline ✅ (was deferred)
- **History screen** (`/history`, nav "History"/"Histórico", URL-synced to the
  workspace selector): a score+coverage **trend** (SVG line chart) over the
  `scan_runs` append-only snapshots, a tabular-number "Past scans" table
  (accessible fallback: timestamp, score, coverage, C/H/M/L, findings), and a
  **two-scan compare** (Newer/Older dropdowns) showing **new / resolved / still-
  open** findings, each linking to the Finding Drawer.
- **Diff is server-side, single-source**: `GET /api/history/diff?ws=&a=&b=`
  computes new/resolved/regressed by rule_id with the **same semantics as
  `compass_core/diff.py`** (used by the report job) — the UI calls the route and
  does not reimplement the logic. Scan ids validated against a strict pattern.
- fevm-moi-ai has 3 real snapshots (score 90.2→89.5→89.1 as findings grew
  4→6→8); the default diff shows New = REL-001, USG-010.

## D15 — Diagnostic depth: Self-check + core checks (real vs NOT_AVAILABLE) ✅
Added real collectors and screens for the domains the workspace's system tables
actually support, and honest NOT_AVAILABLE states elsewhere:
- **Self-check** (app-driven `GET /api/selfcheck`, spec §2.12/§14): runs live
  against Compass's own resources — the `compass-llm` endpoint governance
  (AIG-004: WARN, partially governed), the app SP grants (SEC-031: PASS,
  least-privilege — only USE_SCHEMA/SELECT), scan freshness (MNT-010), and
  catalog/schema reachability. Done app-side (not the scan job) because the app
  holds the SP creds/endpoint/warehouse identity.
- **AI Estate** (AiEstateCollector): endpoint inventory from
  `system.serving.served_entities` (6 endpoints in moi-ai); **AIG-014** (endpoints
  owned by individuals — metlife-fraude) and **AIG-001** (external models). Screen:
  inventory table + AI-spend + governance banner + findings. Per-endpoint Gateway
  config is not in system tables → AIG-003/004 evaluated for Compass's own
  endpoint via Self-check.
- **Governance** (GovernanceCollector): **GOV-025** metadata debt from
  `system.information_schema.tables` (moi_ai_catalog: 111/172 undocumented) +
  **Semantic Readiness** sub-score (35.5% comment coverage). Screen shows the
  readiness breakdown + findings.
- **Genie / Lakebase:** honest **NOT_AVAILABLE** designed states — Genie Agent
  metadata needs the Genie API (not reachable from the serverless scan job);
  Lakebase posture needs a read-only Postgres role (not introspectable). GEN/LKB
  checks resolve NOT_MEASURABLE / NOT_AVAILABLE.
- **Maintenance / Compliance:** Maintenance screen from MNT tasks + Self-check
  MNT-010; **Compliance Wall** now spans **two frameworks**
  (dbx-security-best-practices + **ai-governance-baseline**, added this block),
  control cards colored by status with framework tabs.
- **Coverage rose 72.7% → 75.0%** (data_classification now AVAILABLE); score
  89.5 (more real findings). Capabilities NOT_AVAILABLE with reasons: lakebase,
  mcp_catalog, sat. New rules: AIG-014, GOV-025, GOV-016; new Delta tables:
  `ai_estate_inventory`, `governance_metrics`; `semantic_readiness` on `scan_runs`.

## D16 — Performance/Usage/Reliability + unlocking Genie & Lakebase ✅
(a) **Scan-job collectors** (real system tables, so these domains stop being
100-by-default):
- **Performance** (PerformanceCollector, `system.query.history`): per-identity
  latency for the Utilization Scatter; **PERF-010** fires on high p90 (honestly
  did not fire here — p90 < 30s). `perf_summary` table.
- **Usage** (UsageCollector, `system.access.audit` + `query.history`): active
  users (49), an hour×day activity heatmap, single-identity concentration
  (87.1%) → **USG-010**. `usage_summary` + `usage_heatmap` tables.
- **Reliability** (ReliabilityCollector, `system.lakeflow.job_run_timeline`):
  job failure rate (40.7%, 11/27) → **REL-001** (high). `reliability_summary` table.

(b) **Genie + Lakebase unlocked as APP-SERVER collectors** (these APIs are
reachable from the app SP but NOT from the serverless scan job):
- **Genie** (`GET /api/genie`): lists Genie Agents via the Genie API
  (`/api/2.0/genie/spaces`), samples detail for metadata completeness → GEN-001;
  Genie Quality Board on the screen. Honest NOT_AVAILABLE (with the exact reason)
  if the SP can't list spaces.
- **Lakebase** (`GET /api/lakebase`): lists instances via the **Database
  Instances API** (`/api/2.0/database/instances`) — needs no Postgres role — for
  LKB-003 (running/scale-to-zero). **pg-introspection checks (LKB-001/002/006)
  stay NOT_AVAILABLE**, and the screen states the exact grant the customer must
  provision (a read-only Postgres role: CONNECT + USAGE + SELECT on
  pg_catalog/pg_roles/pg_stat_*). **No grants are created unilaterally**
  (customer-safe default).

New rules PERF-010/USG-010/REL-001; new Delta tables perf_summary,
usage_summary, usage_heatmap, reliability_summary; components Scatter + Heatmap.
Genie/Lakebase findings are surfaced on their screens (app-computed), not in the
scan Delta, so scan-based domain scores for those two remain a follow-up.

## D17 — Lakebase grants + pg-introspection; CAN-MANAGE; Settings; Usage depth ✅
**Approved read-only grants (fevm-moi-ai only), per instance** — applied as owner
(moises.santos) after starting each instance:
```
CREATE ROLE "9e5eaa76-9282-4a5a-be66-41397adf8313" WITH LOGIN;
GRANT CONNECT ON DATABASE databricks_postgres TO "9e5eaa76-...";
GRANT USAGE ON SCHEMA public TO "9e5eaa76-...";
```
on **certifica-db** and **metlife-omnipulse-db** (both created by moises.santos).
`GRANT pg_read_all_stats` was **refused** (owner role lacks ADMIN option on that
built-in role) — not required for LKB-001/002/006, which read world-readable
catalogs. CAN_VIEW isn't a Genie level, so the SP was granted **CAN_RUN** on all
8 Genie spaces.

**pg-introspection runs in the scan job** via **pg8000** (pure-Python; psycopg2
segfaults the serverless kernel), connecting as the job's owner identity with a
`generate-database-credential` token. Evaluates **LKB-001** (native login, from
`enable_pg_native_login`), **LKB-002** (pg_roles superuser/createrole/createdb),
**LKB-006** (tables with tenant_id/workspace_id and `relrowsecurity=false`). Genie
discovery also moved into the scan job (SDK REST). Result: `genie`,
`lakebase`, `lakebase_instances` all resolve **AVAILABLE** → **coverage 75% →
85.7%** (12/14). Findings land in scan Delta → domain scores reflect reality.
Provisioned Lakebase has no scale-to-zero; instances are stopped again after the
run to save cost — the scan's findings persist in Delta.

**Reviewer CAN-MANAGE enforcement**: `/api/changes/status` verifies the acting
user (x-forwarded-email) holds CAN_MANAGE via `GET /api/2.0/permissions/apps/
lakehouse-compass` before Approve/Reject/Needs-info; otherwise **403**. The
decision identity + timestamp show on the change record.

**Settings screen** (last stub → real): policy profile (STRICT/STANDARD/
DEVELOPMENT), §13 config (approved_providers, guardrails, max_days_without_eval,
lakebase thresholds, enabled_frameworks, maintenance lead days), density mode —
persisted in **localStorage** (per-browser; stated in the UI).

**a11y**: added id/name to inputs/selects → console fully clean.

**Usage depth**: active-users weekly trend (`usage_active_users_trend`) + WAU/
MAU/DAU; Genie adoption % (genie users ÷ MAU); Genie surface split via
`system.query.history.client_application` — **"Databricks SQL Genie Space" =
Genie Agents/One** (262 stmts / 2 users). **Genie Code = NOT_AVAILABLE**: this
workspace's query.history has no `query_source` struct and no client_application
value denotes Genie Code, so the Agents/One-vs-Code split cannot be made (never
fabricated).

---

## D18 — WAF per-pillar assessment + product vision (autonomous governance) ✅ / roadmap

**Context.** Compass claims to "unify WAF assessment" (README) but D2 deferred the
WAF mapping. The product intent (stated 2026-09-15): Compass is meant to be the
**primary governance tool for Databricks workspaces**, runnable on *any* workspace,
**piloted autonomously** and overseen by an admin who need not know the platform
deeply — it should do the work, be proactive, and **report the full status** of
what it finds.

**Decision (done this pass).** Made the Well-Architected Framework a first-class,
reportable lens:
- `WafPillar` enum (7 pillars) + `Rule.waf_pillars`; all 21 rules tagged; single
  source of truth is the rule YAML. `RuleRegistry.by_waf_pillar()`.
- Findings carry `waf_pillars` (derived from their rule via
  `scoring.attach_waf_pillars`, so collectors don't each repeat the mapping) and
  persist it to the `findings` Delta table (new `ARRAY<STRING>` column).
- `scoring.score_waf_pillars` → score + open-finding counts + **coverage**
  (mapped-rule count) per pillar; surfaced in `Score.waf_pillars`.
- New `waf_scores` Delta table, written by the scan job; query
  `config/queries/waf_scores.sql` + fixture fallback `/api/rows/waf_scores`.
- App **Well-Architected** page (`/waf`) ranks pillars weakest-first and flags
  **limited coverage** (a high score with few rules ≠ proven health) — an honest,
  non-expert-friendly status view. Full gap analysis: `docs/WAF_GAP_ANALYSIS.md`.

**Autonomous-governance vision — progress.**
- ✅ **Proactive digest (done 2026-09-15)** — `compass_core.digest` turns the last
  two scans into a plain-language status (score + trend, weakest *measured* WAF
  pillars, pillars barely checked yet, new/resolved/still-open, criticals to act
  on). Job `compass_digest` (`jobs/digest/run_digest.py`) reads Delta, appends to
  the `digests` table, and pushes the narrative to Slack when `COMPASS_SLACK_WEBHOOK`
  is set (no-op otherwise). Verified live on fevm-moi-ai. Never executes.
- ⏭️ **Turn on the cadence** — `compass_scan` and `compass_digest` schedules are
  PAUSED by default (cost). Flip `pause_status: UNPAUSED` (digest cron is 30 min
  after the scan) and set `COMPASS_SLACK_WEBHOOK` to make Compass report on its own.
- ✅ **`/digest` app view (done 2026-09-15)** — reads the `digests` table (query
  `digests.sql` + fixture fallback): score + trend, weakest pillars, what changed,
  limited-coverage flags, plus the live remediation plan below.
- ✅ **Advisor triage (done 2026-09-15)** — deterministic prioritized plan:
  `buildRemediationPlan` (server) ranks open findings by severity × how weak the
  WAF pillar they touch is; exposed as `GET /api/agent/plan`, as the agent tool
  `propose_remediation_plan`, and on `/digest` with a **one-click "Draft change"**
  (`POST /api/agent/draft` → `proposed_changes` → `/changes` for CAN-MANAGE
  approval). Compass still never executes.
- ✅ **Proactive reporting (done 2026-09-15)** — the premium PDF (D11) now carries
  the plain-language digest narrative + weakest-pillar pills in the executive
  summary (built inline via `compass_core.digest`, no dependency on the digest job).
- ✅ **Runs on any workspace (done 2026-09-15)** — the scan job now loops per
  workspace. `--workspace_id` takes a single id, a comma list, or `all`;
  `--all_workspaces` scans billing-active workspaces (via `_active_workspaces`,
  highest spend first) capped by `--max_workspaces` (default 25) so discovery of
  thousands (4115 here) never runs unbounded. Per-ws work is a nested `_scan_one`;
  system-table domains run for every target, while Genie/Lakebase (SDK-scoped to
  the local ws) run only for `local_ws`, which is resolved authoritatively from
  `WorkspaceClient.get_workspace_id()` (spark conf `clusterOwnerOrgId` is absent on
  serverless — using it wrongly marked the local ws remote and dropped coverage
  85.7%→64.3%; the SDK id fixed it back to 85.7%). Remote workspaces mark
  genie/lakebase capabilities NOT_AVAILABLE honestly. The UI's Account-mode
  selector already lists every scanned ws.

## D19 — FinOps cost drill-down ✅

**Context.** FinOps showed cost by product (Treemap) and by identity, but no way to
see *what* inside a product is spending (which app, endpoint, job, warehouse) or who
owns it.

**Decision.** Added a per-resource breakdown. `FinOpsCollector` emits a `cost_detail`
inventory from `system.billing.usage` — grouping by product, sku, run-as identity,
and a resource_type/resource_name derived from `usage_metadata` (app_name,
endpoint_name, job_name, warehouse_id, dlt_pipeline_id, cluster_id…) plus owner from
`identity_metadata`. Best-effort: a metastore missing a `usage_metadata` field fails
only the detail query, not the summary. New Delta table `cost_detail`, query
`cost_detail.sql` + fixture. The Treemap is now clickable (`onSelect`/`selected`); a
click drills down in-place to a table of resource · identity · owner · DBUs · cost,
falling back to the summary's identity/SKU rows if per-resource detail is absent.
Verified live: APPS drills to certifica-att, semana-ia-santander, streamline-care-desk,
genie-cost-calculator, … each with owner and cost.

**Filters + unattributed attribution (2026-09-15).** `cost_detail` also carries
`tags_json` (`to_json(custom_tags)`). The drill-down adds a **user filter** (matches
run-as OR owner) and a **tag filter** (`key=value`). The `(unattributed)` problem —
`identity_metadata.run_as` is NULL for serverless Apps/warehouses/Lakebase — is
resolved by **owner-based effective attribution**: when run-as is null the UI shows
`owned_by`/`created_by` marked "(via owner)", and the `Owner` custom tag (present on
most rows here) is filterable. Root-cause remediation stays FIN-027 (tag policy +
run-as on jobs).

## D18 — Genie Ontology Readiness (integrated feature) ✅
A faithful port of `databricks-solutions/genie-ontology-readiness` into Compass:
a **0–100 readiness score across 7 weighted pillars** (uc_foundation 15, metadata
22, relationships 12, metrics 20, genie_agents 16, domains 10, adoption 5 = 100),
each with a 0–4 maturity level, a readiness-stage band, per-pillar signals + gaps
and gap-driven "focus next on…" guidance. **Re-implemented in Compass style**, not
by copying the reference FastAPI/OBO async code: `GenieReadinessCollector`
(`collectors/genie_readiness.py`) runs the 7 read-only probes via synchronous
`spark.sql` in the scan job. Data-source resilience mirrors the reference — prefer
metastore-wide `system.information_schema`, else union each accessible catalog's
own `information_schema`; every source failure resolves that pillar `available=
False` with an honest reason (never fabricated). Genie/adoption pillars are scoped
to the workspace via `system.access.audit` / `system.query.history`, so — like the
Genie/Lakebase collectors — the collector runs **only for the local workspace**.
UC-metadata pillars are inherently **metastore-wide** (information_schema has no
workspace_id); the screen states this.

**Persistence**: two append-only Delta tables (per scan_id+workspace_id) —
`genie_readiness` (overall score/level/stage/guidance/top_gaps) and
`genie_readiness_pillars` (row per pillar: score/technical_score/level/available/
unavailable_reason/signals_json/gaps_json/metrics_json). App SP granted USE +
SELECT (schema-level SELECT already covers future tables; explicit grants in
`sql/ddl/schema.sql`). **Rules**: `rules/definitions/genie_readiness.yaml` adds
`GEN-READY-{UC,METADATA,RELATIONSHIPS,METRICS,AGENTS,DOMAINS,ADOPTION}` mapped to
`data_ai_governance` + `interoperability_usability`; the collector emits a finding
for each AVAILABLE pillar with a gap (severity scaled by maturity level: L0→high,
L1→medium, L2→low, ≥L3 none), so gaps flow into Findings/WAF/digest. Findings use
`domain="genie_readiness"` (weight 0 in DOMAIN_WEIGHTS → does not distort the
overall Compass health score). **UI**: nav item "Genie Readiness" in the Govern
section, screen at `/genie-readiness` — overall gauge + readiness-stage badge +
guidance, an inline-SVG **radar** of the 7 pillars (`components/Radar.tsx`, no
charting dependency), pillar cards (weight/score/level/signals/gaps, NotAvailable
for unavailable pillars) and a Top Gaps list; workspace-scoped via `?ws=`, with the
`useLiveRows` live-or-fixture pattern (queries `genie_readiness{,_pillars}.sql` +
`/api/rows/*` fallback + demo fixtures). i18n en + pt-BR.

### D18a — Overall score renormalizes over AVAILABLE pillars (diverges from OSS reference) ✅
The reference app divides the weighted pillar sum by the full weight of **all 7
pillars**, scoring any pillar whose source is ungranted as 0 — which silently
**deflates** the overall score when the scan identity lacks (say) `system.access.audit`
or `information_schema` on some catalogs. Compass intentionally **diverges**: the
overall is the weighted mean over **available pillars only** (unavailable pillars are
excluded from BOTH numerator and denominator), consistent with Compass's honest
NOT_AVAILABLE ethos — a score is never fabricated *low* any more than it is fabricated
*high*. To keep this transparent, the summary payload carries `pillars_available` +
`pillars_total` and the screen shows an **"N / 7 assessed"** coverage badge next to the
readiness gauge, and the radar renders unavailable pillars distinctly (dashed spoke,
no vertex, "n/a" label) rather than as a solid 0. Related scan-job correctness fixes
shipped together: the Genie Agents roster uses a wider 180-day lookback (`_AGENT_ROSTER_LOOKBACK_DAYS`)
so `active` (strict 30d) can legitimately be < `total`; the adoption pillar now emits
low-adoption gaps so `GEN-READY-ADOPTION` can fire; the domains tag-coverage % applies
the same internal-catalog filter to numerator and denominator (pct ≤ 100); and the
`--all_workspaces` target list front-loads the local workspace before the cap so it
never exceeds `--max_workspaces`.

## D20 — AIG-004 (agent endpoint gateway governance): accepted deviation ✅

**Context.** The Compass Agent calls the shared system foundation-model endpoint
`databricks-claude-sonnet-4-5` (`system.ai.databricks-claude-sonnet-4-5`,
pay-per-token). Its AI Gateway has `usage_tracking=on` but `guardrails=off` and
`payload_logging (inference tables)=off`, which the app honestly surfaces as
finding **AIG-004** (amber banner on the Agent + AI Estate screens, and Self-check).

**Investigation (22-set-2026).** A *dedicated* governed serving endpoint for this
FM is **not possible**: creating a custom endpoint that serves
`system.ai.databricks-claude-sonnet-4-5` is rejected by Databricks
("Model … is not supported for inference at this time"). Pay-per-token FMs are
only reachable via the pre-provisioned shared endpoints. The remaining ways to
fully clear AIG-004 each carry a worse trade-off:
- **Configure the shared endpoint** (enable inference tables + guardrails on
  `databricks-claude-sonnet-4-5`): endpoint-wide — it would log the prompts/
  responses of **every** user of that FM in `fevm-moi-ai` and apply guardrails to
  all of them. Broad, privacy-sensitive, not ours to impose.
- **External-model proxy** (an `external_model` endpoint with provider
  `databricks-model-serving` pointing at the shared endpoint, with full gateway):
  isolates Compass traffic, but requires storing a Databricks **token as a secret**
  — a governance smell inside a *governance* app.

**Decision.** **Accept the deviation** for this internal/demo app. No infra
change. The app already reports it truthfully rather than hiding it, which is the
honest-diagnostic ethos of Compass (cf. NOT_AVAILABLE handling, [[D18a]]).

**Before real production use**, front the agent with a properly governed endpoint
so Compass traffic is guarded and logged **in isolation** (never on the shared
endpoint): input/output guardrails (PII, prompt-injection, content policy) +
inference tables / payload logging + usage tracking + a spend cap. The
external-model proxy above (secret-scoped token) or a provisioned-throughput
endpoint are the viable shapes. Until then AIG-004 stays surfaced by design.

## Deferred to later phases
- ⏭️ **Lakebase app state** (exceptions, approvals, checklist assignments,
  maintenance tasks, agent memory, preferences) — Phase 1/2. Schema/roles per
  spec §3.2 / §14.
- ⏭️ **Compass Agent** (Unity AI Gateway–governed endpoint, whitelisted
  read-only tools, citations, guardrails, approval workflow, MLflow eval set) —
  Phase 2 (spec §9).
- ⏭️ **The full ~150 rules** across nine domains — Phase 0 ships 10 real rules
  across Security/FinOps/AI-Estate/Genie/Lakebase; core breadth in Phase 1.
- ⏭️ **All compliance frameworks** — Phase 0 ships
  `dbx-security-best-practices`; CIS, ISO 27001, SOC 2, NIST CSF 2.0,
  LGPD/GDPR, ai-governance-baseline in Phase 1/2 (spec §7).
- ⏭️ **Live collectors** (System Tables, Apps/Serving/Genie/Lakebase APIs, SAT
  ingestion) — Phase 1+; Phase 0 uses synthetic fixtures.
- ⏭️ **Rich signature visuals** beyond the Health Ring + domain cards (Cost Flow
  Sankey, Agent Topology, Compliance Wall, Scan Diff Timeline, Executive Story
  mode) — Phase 1/2 (spec §20.3).
- ⏭️ **Self-check, Changes, Agent screens** — currently designed stubs; wired in
  Phase 2.
