# Architecture

## Tiers (spec §3.1)
```
SCAN JOB (Lakeflow, Python)  → collectors → rule engine → scoring → compliance mapper
                             → writes main.lakehouse_compass.* (Delta)
APP (Databricks Apps, AppKit)→ UI + API; reads Delta (Analytics), app state in
                               Lakebase, LLM via Unity AI Gateway endpoint
CHECK-UP REPORT JOB (weekly) → check-up + maintenance digest to Delta/Volume
```

## Functional vs stubbed (through Phase 1)
| Area | Status |
|---|---|
| AppKit shell, 17-screen nav, i18n en/pt-BR, dark-first theme, theme toggle | ✅ functional |
| **Live data path**: scan job → `moi_ai_catalog.lakehouse_compass.*` Delta; app reads via analytics plugin (`config/queries/*.sql`) with `/api/rows/*` fixture fallback | ✅ functional (Phase 1) |
| **Overview** — live scores/findings/cost, Health Ring, domain cards, AI-spend, compliance %, maintenance, Live/Demo badge | ✅ functional (live) |
| **Findings** — filterable table + Finding Drawer (evidence/remediation/controls) | ✅ functional (live) |
| **FinOps** — Spend Treemap (SVG), spend-by-identity, unattributed %, AI spend | ✅ functional (live) |
| **Security** — posture score, findings-by-severity, open findings + drawer | ✅ functional (live) |
| Real collectors: FinOps (billing.usage + list_prices) · Security (information_schema privileges) | ✅ functional (read-only) |
| `compass_core` models / capability manager / scoring / rule registry / compliance mapper | ✅ functional |
| Rules: SEC-014/027/029/030, FIN-027/028/029/030, AIG-003/004, GEN-013, LKB-001/002 | ✅ functional |
| `dbx-security-best-practices` framework + mapper | ✅ functional |
| AI-Estate / Governance / Performance / Usage / Genie / Lakebase / Reliability / Compliance / Maintenance screens | 🟡 designed stubs |
| Changes / Agent / Self-check screens | ⏭️ Phase 2 stubs |
| Lakebase app state, Compass Agent, remaining collectors/rules/frameworks | ⏭️ deferred (see DECISIONS.md) |

Capabilities resolving **NOT_AVAILABLE** in this workspace (honest, not faked):
`lakebase` (needs a read-only Postgres role, not introspectable from the scan
job), `mcp_catalog` (MCP Catalog API not enabled/preview), `sat` (customer must
run the Security Analysis Tool). All other probed sources are AVAILABLE →
coverage 72.7%.

## Client
React 19 + react-router. `lib/api.ts` fetches `/api/*` with an embedded
fallback so every screen renders a designed state even if the API is
unreachable (spec §20.4). Theme is dark-first with semantic tokens
(`--sev-*`, `--domain-*`, motion tokens) in `client/src/index.css` (spec §20.2);
`prefers-reduced-motion` collapses storytelling motion.

## Server
`server/server.ts` boots AppKit with the `server` plugin only (binds
`0.0.0.0:DATABRICKS_APP_PORT`, serves `client/dist`, SPA fallback, SIGTERM
shutdown). `server/routes/api-routes.ts` registers read-only demo routes via
`appkit.server.extend`. No live resources are bound in Phase 0.

## Rule engine (`packages/compass_core`)
- `models/` — Finding, Capability, Rule, Score (stdlib dataclasses).
- `capabilities/manager.py` — probe stubs resolving AVAILABLE / DEGRADED /
  NOT_AVAILABLE; computes rule coverage.
- `rules/definitions/*.yaml` + `rules/registry.py` — declarative rules.
- `rules/evaluators/base.py` — evaluator protocol + NOT_MEASURABLE fallback.
- `scoring.py` — weighted domain + overall score (spec §6 weights).
- `compliance/mapper.py` + `frameworks/*.yaml` — advisory control mapping.
- `demo/fixtures.py` — synthetic end-to-end scan for DEMO_MODE and the job.
