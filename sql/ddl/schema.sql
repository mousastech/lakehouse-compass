-- Lakehouse Compass storage schema (spec §10, §11).
-- The scan job (jobs/scan/run_scan.py) creates/appends these; the report job
-- appends checkup_reports. Catalog is moi_ai_catalog because `main` is not
-- accessible in this workspace (see DECISIONS.md D7). Every diagnostic row
-- carries the workspace dimension (D9); history tables are append-only (D10).

CREATE SCHEMA IF NOT EXISTS moi_ai_catalog.lakehouse_compass;
CREATE VOLUME IF NOT EXISTS moi_ai_catalog.lakehouse_compass.reports;

CREATE TABLE IF NOT EXISTS moi_ai_catalog.lakehouse_compass.findings (
  finding_id STRING, rule_id STRING, domain STRING, title STRING, severity STRING,
  resource STRING, status STRING, framework_controls ARRAY<STRING>, waf_pillars ARRAY<STRING>,
  evidence_json STRING, remediation STRING, maintenance_task_id STRING, self_check BOOLEAN,
  scan_id STRING, workspace_id STRING, workspace_name STRING, detected_at STRING
) USING DELTA;

-- Per-WAF-pillar sub-scores (one row per pillar per scan; append-only for history).
-- Phase 2 adds control-catalogue coverage (controls_total/measured/passed) and the
-- confidence band (low/high). New columns land via mergeSchema on append (non-destructive).
CREATE TABLE IF NOT EXISTS moi_ai_catalog.lakehouse_compass.waf_scores (
  scan_id STRING, workspace_id STRING, workspace_name STRING, pillar STRING,
  score DOUBLE, findings INT, critical_findings INT, rules INT, computed_at STRING,
  controls_total BIGINT, controls_measured BIGINT, controls_passed BIGINT, low DOUBLE, high DOUBLE
) USING DELTA;

-- WAF control catalogue outcomes — one row per (scan, workspace, control). Drives the
-- Well-Architected drill-down: status (pass/gap/unmeasured/attestation) + remediation.
CREATE TABLE IF NOT EXISTS moi_ai_catalog.lakehouse_compass.waf_controls (
  scan_id STRING, workspace_id STRING, workspace_name STRING, pillar STRING, control_id STRING,
  principle STRING, title STRING, provenance STRING, measurability STRING, severity STRING,
  status STRING, measured BOOLEAN, rule_id STRING, remediation STRING, doc_url STRING
) USING DELTA;
GRANT SELECT ON TABLE moi_ai_catalog.lakehouse_compass.waf_controls TO `9e5eaa76-9282-4a5a-be66-41397adf8313`;

CREATE TABLE IF NOT EXISTS moi_ai_catalog.lakehouse_compass.scores (
  scan_id STRING, workspace_id STRING, workspace_name STRING, domain STRING, weight INT,
  score DOUBLE, findings INT, critical_findings INT, is_overall BOOLEAN, coverage_pct DOUBLE,
  computed_at STRING
) USING DELTA;

CREATE TABLE IF NOT EXISTS moi_ai_catalog.lakehouse_compass.capabilities (
  scan_id STRING, workspace_id STRING, workspace_name STRING, capability_id STRING,
  source STRING, availability STRING, last_tested STRING
) USING DELTA;

CREATE TABLE IF NOT EXISTS moi_ai_catalog.lakehouse_compass.compliance_results (
  scan_id STRING, workspace_id STRING, workspace_name STRING, framework STRING, control_id STRING,
  title STRING, category STRING, status STRING, linked_findings ARRAY<STRING>, computed_at STRING
) USING DELTA;

CREATE TABLE IF NOT EXISTS moi_ai_catalog.lakehouse_compass.cost_summary (
  scan_id STRING, workspace_id STRING, workspace_name STRING, product STRING, sku STRING,
  identity STRING, cost_usd DOUBLE, dbus DOUBLE, is_ai BOOLEAN
) USING DELTA;

-- Per-resource cost breakdown for the FinOps drill-down (product → resource/identity).
CREATE TABLE IF NOT EXISTS moi_ai_catalog.lakehouse_compass.cost_detail (
  scan_id STRING, workspace_id STRING, workspace_name STRING, product STRING, sku STRING,
  identity STRING, resource_type STRING, resource_name STRING, owner STRING, tags_json STRING,
  cost_usd DOUBLE, dbus DOUBLE, records BIGINT
) USING DELTA;

-- Immutable per-run snapshot (append-only) — trend/diff over time.
CREATE TABLE IF NOT EXISTS moi_ai_catalog.lakehouse_compass.scan_runs (
  scan_id STRING, workspace_id STRING, workspace_name STRING, generated_at STRING,
  overall_score DOUBLE, coverage_pct DOUBLE, total_findings INT,
  crit INT, high INT, med INT, low INT, domain_scores_json STRING
) USING DELTA;

-- Discovered workspace inventory (current snapshot, overwritten each scan).
CREATE TABLE IF NOT EXISTS moi_ai_catalog.lakehouse_compass.workspaces (
  workspace_id STRING, workspace_name STRING, env_label STRING, discovered_via STRING
) USING DELTA;

-- Proactive status digests (append-only) — one row per digest run. Turns two
-- consecutive scans into a plain-language status; optionally pushed to Slack.
CREATE TABLE IF NOT EXISTS moi_ai_catalog.lakehouse_compass.digests (
  digest_id STRING, scan_id STRING, prev_scan_id STRING, workspace_id STRING, workspace_name STRING,
  generated_at STRING, score DOUBLE, score_delta DOUBLE, coverage_pct DOUBLE,
  crit INT, high INT, med INT, low INT,
  weakest_pillars_json STRING, limited_pillars_json STRING,
  new_json STRING, resolved_json STRING, still_open_json STRING, criticals_json STRING,
  narrative STRING, pushed BOOLEAN, push_target STRING
) USING DELTA;

-- Genie Ontology Readiness — summary per scan+workspace (append-only for history).
-- Overall 0-100 readiness score across 7 weighted pillars + maturity + stage + guidance.
CREATE TABLE IF NOT EXISTS moi_ai_catalog.lakehouse_compass.genie_readiness (
  scan_id STRING, workspace_id STRING, workspace_name STRING,
  overall_score DOUBLE, level INT, level_label STRING, readiness_stage STRING,
  guidance STRING, top_gaps_json STRING, pillars_available INT, assessed_at STRING
) USING DELTA;

-- Genie Ontology Readiness — one row per pillar per scan (append-only).
CREATE TABLE IF NOT EXISTS moi_ai_catalog.lakehouse_compass.genie_readiness_pillars (
  scan_id STRING, workspace_id STRING, workspace_name STRING,
  pillar_key STRING, name STRING, weight INT, score DOUBLE, technical_score DOUBLE,
  level INT, level_label STRING, available BOOLEAN, unavailable_reason STRING,
  signals_json STRING, gaps_json STRING, metrics_json STRING
) USING DELTA;

-- App SP reads the readiness tables via the analytics plugin (schema-level SELECT
-- already covers future tables; these are explicit for clarity / idempotency).
GRANT USE CATALOG ON CATALOG moi_ai_catalog TO `9e5eaa76-9282-4a5a-be66-41397adf8313`;
GRANT USE SCHEMA ON SCHEMA moi_ai_catalog.lakehouse_compass TO `9e5eaa76-9282-4a5a-be66-41397adf8313`;
GRANT SELECT ON TABLE moi_ai_catalog.lakehouse_compass.genie_readiness TO `9e5eaa76-9282-4a5a-be66-41397adf8313`;
GRANT SELECT ON TABLE moi_ai_catalog.lakehouse_compass.genie_readiness_pillars TO `9e5eaa76-9282-4a5a-be66-41397adf8313`;

-- Generated diagnostic reports (append) — one row per PDF.
CREATE TABLE IF NOT EXISTS moi_ai_catalog.lakehouse_compass.checkup_reports (
  report_id STRING, scan_id STRING, workspace_id STRING, workspace_name STRING, generated_at STRING,
  overall_score DOUBLE, coverage_pct DOUBLE, crit INT, high INT, med INT, low INT,
  framework STRING, met INT, not_met INT, rendered STRING, volume_path STRING
) USING DELTA;
