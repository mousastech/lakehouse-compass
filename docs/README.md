# Lakehouse Compass

> The Databricks platform doctor: continuous check-up, maintenance, compliance
> and remediation planning — for data, compute, Unity Catalog, Genie, agents,
> Unity AI Gateway and Lakebase.

Lakehouse Compass is the operating layer that unifies WAF assessment, SAT
security, agent-control-plane AI observability, Genie Workbench quality and
FinOps into one prioritized, maintained, compliance-mapped backlog with an
advisor agent — **not a replacement for any of them**.

## What it does
1. **Check-up** — scheduled scans evaluate rules across nine domains (Security,
   FinOps, AI Estate, Governance, Performance, Usage, Genie, Lakebase,
   Reliability) and produce prioritized findings with evidence and remediation.
2. **Maintenance** — a calendar of recurring hygiene tasks with owners/due dates.
3. **Compliance** — control checklists mapping rules to frameworks (advisory).
4. **Advisor agent** — a governed LLM that explains, prioritizes and plans —
   never executes. *(Phase 2.)*

## Phase 0 (this build)
A deployable AppKit shell in **DEMO_MODE** plus the `compass_core` rule engine
skeleton and a demo scan job. See [`../DECISIONS.md`](../DECISIONS.md) for the
architecture decisions and the roadmap. Functional vs stubbed status is listed
there and in `docs/ARCHITECTURE.md`.

## Repo layout
```
databricks.yml            DAB root (targets dev/staging/prod; dev default)
resources/                app.yml, scan_job.yml
app/                      AppKit app (server plugin + React client)
packages/compass_core/    Python: models, capabilities, rules, scoring, compliance, demo
jobs/scan/run_scan.py     Lakeflow scan job (demo → Delta)
sql/ddl/schema.sql        main.lakehouse_compass.* tables
tests/                    unit tests (scoring, rules, compliance)
docs/                     README, ARCHITECTURE, PERMISSIONS, DEPLOYMENT
```

## Deploy
See [`DEPLOYMENT.md`](DEPLOYMENT.md). Short version:
```bash
databricks bundle validate -t dev --profile fevm-moi-ai
databricks bundle deploy   -t dev --profile fevm-moi-ai
databricks bundle run compass_app -t dev --profile fevm-moi-ai
```
