// Fixture rows shaped EXACTLY like the scan job's Delta output, so the client's
// live-or-fixture hook renders identically whether reading Delta or the fallback.

export const scoresRows = [
  { domain: 'security', weight: 25, score: 68, findings: 14, critical_findings: 2, is_overall: false, coverage_pct: 82 },
  { domain: 'finops', weight: 20, score: 74, findings: 11, critical_findings: 0, is_overall: false, coverage_pct: 82 },
  { domain: 'ai_estate', weight: 12, score: 61, findings: 8, critical_findings: 1, is_overall: false, coverage_pct: 82 },
  { domain: 'governance', weight: 12, score: 79, findings: 9, critical_findings: 0, is_overall: false, coverage_pct: 82 },
  { domain: 'performance', weight: 10, score: 83, findings: 5, critical_findings: 0, is_overall: false, coverage_pct: 82 },
  { domain: 'usage', weight: 8, score: 88, findings: 3, critical_findings: 0, is_overall: false, coverage_pct: 82 },
  { domain: 'genie', weight: 6, score: 71, findings: 4, critical_findings: 0, is_overall: false, coverage_pct: 82 },
  { domain: 'lakebase', weight: 4, score: 65, findings: 3, critical_findings: 0, is_overall: false, coverage_pct: 82 },
  { domain: 'reliability', weight: 3, score: 90, findings: 1, critical_findings: 0, is_overall: false, coverage_pct: 82 },
  { domain: 'OVERALL', weight: 100, score: 73, findings: 49, critical_findings: 3, is_overall: true, coverage_pct: 82 },
];

export const findingsRows = [
  {
    finding_id: 'F-1001', rule_id: 'SEC-027', domain: 'security',
    title: 'App service principal holds ALL PRIVILEGES on a catalog', severity: 'critical',
    resource: 'sp: compass-app / catalog: main', status: 'open',
    framework_controls: ['DBX-SBP:IAM-3', 'ISO27001:A.5.15', 'SOC2:CC6.1'],
    evidence_json: JSON.stringify({ privilege: 'ALL PRIVILEGES', scope: 'catalog' }),
    remediation: 'REVOKE ALL PRIVILEGES and grant the minimum on specific schemas.', self_check: true,
  },
  {
    finding_id: 'F-1004', rule_id: 'SEC-029', domain: 'security',
    title: 'Workspace still allows PATs where OAuth is feasible', severity: 'high',
    resource: 'workspace: fevm-moi-ai', status: 'open',
    framework_controls: ['DBX-SBP:IAM-5', 'CIS:1.2'],
    evidence_json: JSON.stringify({ pat_enabled: true }),
    remediation: 'Disable PATs or cap lifetime; migrate to OAuth.', self_check: false,
  },
  {
    finding_id: 'F-1002', rule_id: 'AIG-003', domain: 'ai_estate',
    title: 'Serving endpoint without spend cap; unattributed AI spend', severity: 'high',
    resource: 'endpoint: prod-rag-router', status: 'open',
    framework_controls: ['AIGOV:BUDGET-1', 'DBX-SBP:MON-2'],
    evidence_json: JSON.stringify({ spend_cap: null }),
    remediation: 'Front with Unity AI Gateway; set budgets and spend cap.', self_check: false,
  },
  {
    finding_id: 'F-1005', rule_id: 'FIN-029', domain: 'finops',
    title: 'Lakebase project without scale-to-zero on non-production compute', severity: 'medium',
    resource: 'lakebase: analytics-dev', status: 'open',
    framework_controls: ['DBX-SBP:MON-4'],
    evidence_json: JSON.stringify({ scale_to_zero: false }),
    remediation: 'Enable scale-to-zero; prune idle branches/snapshots.', self_check: false,
  },
  {
    finding_id: 'F-1006', rule_id: 'GEN-013', domain: 'genie',
    title: 'Genie Agent built on tables without certified metric views', severity: 'medium',
    resource: 'genie: revenue-explorer', status: 'open',
    framework_controls: ['DBX-SBP:GOV-2'],
    evidence_json: JSON.stringify({ certified_metric_views: 0 }),
    remediation: 'Define & certify UC metric views for core metrics.', self_check: false,
  },
];

export const costSummaryRows = [
  { product: 'APPS', sku: 'ENTERPRISE_ALL_PURPOSE_SERVERLESS', identity: '(unattributed)', cost_usd: 1962.82, dbus: 2077.3, is_ai: false },
  { product: 'LAKEBASE', sku: 'ENTERPRISE_DATABASE_SERVERLESS', identity: '(unattributed)', cost_usd: 1076.1, dbus: 2069.3, is_ai: false },
  { product: 'SQL', sku: 'ENTERPRISE_SERVERLESS_SQL', identity: 'moises.santos@demo', cost_usd: 103.29, dbus: 145.4, is_ai: false },
  { product: 'GENIE', sku: 'GENIE_FREE_USAGE', identity: '(unattributed)', cost_usd: 41.87, dbus: 387.9, is_ai: false },
  { product: 'LAKEHOUSE_REAL_TIME', sku: 'SERVERLESS_REAL_TIME_INFERENCE', identity: 'svc-rag', cost_usd: 25.38, dbus: 612.2, is_ai: true },
  { product: 'INTERACTIVE', sku: 'ENTERPRISE_ALL_PURPOSE', identity: 'moises.santos@demo', cost_usd: 10.59, dbus: 10.6, is_ai: false },
];

export const costDetailRows = [
  { product: 'APPS', sku: 'APPS_SERVERLESS_COMPUTE', identity: 'moises.santos@demo', resource_type: 'app', resource_name: 'lakehouse-compass', owner: 'moises.santos@demo', tags_json: '{"team":"platform","env":"prod"}', cost_usd: 128.4, dbus: 214.0, records: 412 },
  { product: 'APPS', sku: 'APPS_SERVERLESS_COMPUTE', identity: 'ana.lima@demo', resource_type: 'app', resource_name: 'certifica-att', owner: 'ana.lima@demo', tags_json: '{"team":"enablement","env":"prod"}', cost_usd: 96.2, dbus: 160.3, records: 388 },
  { product: 'APPS', sku: 'APPS_SERVERLESS_COMPUTE', identity: '(unattributed)', resource_type: 'app', resource_name: 'semana-ia-santander', owner: 'moises.santos@demo', tags_json: '{"team":"enablement"}', cost_usd: 41.7, dbus: 69.5, records: 121 },
  { product: 'MODEL_SERVING', sku: 'MODEL_SERVING_GPU', identity: 'sp-rag-router', resource_type: 'serving_endpoint', resource_name: 'prod-rag-router', owner: 'platform@demo', tags_json: '{"team":"ml","env":"prod"}', cost_usd: 212.9, dbus: 355.0, records: 903 },
  { product: 'JOBS', sku: 'JOBS_SERVERLESS', identity: 'data-eng@demo', resource_type: 'job', resource_name: 'nightly-batch', owner: 'data-eng@demo', tags_json: '{"team":"data-eng","env":"prod"}', cost_usd: 74.5, dbus: 149.0, records: 88 },
  { product: 'SQL', sku: 'SQL_SERVERLESS', identity: '(unattributed)', resource_type: 'warehouse', resource_name: 'Serverless Starter', owner: 'analyst@demo', tags_json: '{}', cost_usd: 63.1, dbus: 126.2, records: 540 },
];

export const complianceRows = [
  { framework: 'dbx-security-best-practices', control_id: 'DBX-SBP:IAM-3', title: 'Least-privilege service principals', category: 'Identity', status: 'NOT_MET' },
  { framework: 'dbx-security-best-practices', control_id: 'DBX-SBP:GOV-1', title: 'Tagging is a controlled boundary', category: 'Governance', status: 'NOT_MET' },
  { framework: 'dbx-security-best-practices', control_id: 'DBX-SBP:MON-2', title: 'AI spend attributed and capped', category: 'Monitoring', status: 'NOT_MET' },
  { framework: 'dbx-security-best-practices', control_id: 'DBX-SBP:NET-1', title: 'Private connectivity / IP access lists', category: 'Network', status: 'MANUAL' },
  { framework: 'dbx-security-best-practices', control_id: 'DBX-SBP:CMP-1', title: 'Supported runtimes', category: 'Compute', status: 'MANUAL' },
];

export const workspacesRows = [
  { workspace_id: '7474658545709121', workspace_name: 'moi-ai', env_label: 'unknown' },
];

export const trendRows = [
  { scan_id: 'demo-2', workspace_id: '7474658545709121', workspace_name: 'moi-ai', generated_at: new Date().toISOString(), overall_score: 90.2, coverage_pct: 72.7, crit: 1, high: 2, med: 1, low: 0, total_findings: 4 },
  { scan_id: 'demo-1', workspace_id: '7474658545709121', workspace_name: 'moi-ai', generated_at: new Date(Date.now() - 864e5).toISOString(), overall_score: 86.5, coverage_pct: 72.7, crit: 1, high: 3, med: 1, low: 0, total_findings: 5 },
];

export const reportsRows = [
  { report_id: 'demo-rpt', scan_id: 'demo-2', workspace_id: '7474658545709121', workspace_name: 'moi-ai', generated_at: new Date().toISOString(), overall_score: 90.2, coverage_pct: 72.7, crit: 1, high: 2, med: 1, low: 0, framework: 'dbx-security-best-practices', met: 0, not_met: 3, rendered: 'pdf', volume_path: '/Volumes/moi_ai_catalog/lakehouse_compass/reports/compass_demo.pdf' },
];

export const aiEstateRows = [
  { endpoint_name: 'databricks-claude-sonnet-4-5', entity_type: 'FOUNDATION_MODEL', owner: 'System-User', entity_name: 'claude', workspace_id: '7474658545709121' },
  { endpoint_name: 'metlife-fraude', entity_type: 'CUSTOM_MODEL', owner: 'someone@demo', entity_name: 'fraud', workspace_id: '7474658545709121' },
];

// AI Gateway governance per endpoint (mirrors ai_gateway_config).
export const aiGatewayConfigRows = [
  { endpoint_name: 'metlife-fraude', usage_tracking: true, payload_logging: true, rate_limits: true, guardrails: false, governed: false, workspace_id: '7474658545709121' },
  { endpoint_name: 'prod-rag-router', usage_tracking: true, payload_logging: false, rate_limits: false, guardrails: false, governed: false, workspace_id: '7474658545709121' },
  { endpoint_name: 'sales-copilot', usage_tracking: true, payload_logging: true, rate_limits: true, guardrails: true, governed: true, workspace_id: '7474658545709121' },
];

// Per-endpoint usage / where-used (mirrors endpoint_usage_summary).
export const endpointUsageSummaryRows = [
  { endpoint_name: 'metlife-fraude', requests_30d: 18422, requesters: 6, in_tokens: 4210000, out_tokens: 980000, error_rate: 1.2, last_request: new Date().toISOString(), top_requesters_json: JSON.stringify([{ requester: 'svc-fraud@demo', requests: 12000 }, { requester: 'ana.lima@demo', requests: 3200 }, { requester: 'app-scoring', requests: 3222 }]), workspace_id: '7474658545709121' },
  { endpoint_name: 'prod-rag-router', requests_30d: 5310, requesters: 3, in_tokens: 1560000, out_tokens: 410000, error_rate: 4.8, last_request: new Date().toISOString(), top_requesters_json: JSON.stringify([{ requester: 'sp-rag-router', requests: 4900 }, { requester: 'carlos.rocha@demo', requests: 410 }]), workspace_id: '7474658545709121' },
];

export const governanceMetricsRows = [
  { metric: 'comment_coverage_pct', value: 35.5, detail: 'moi_ai_catalog' },
  { metric: 'tables_total', value: 172, detail: 'moi_ai_catalog' },
  { metric: 'tables_undocumented', value: 111, detail: 'moi_ai_catalog' },
];

export const perfSummaryRows = [
  { entity: 'moises.santos@demo', queries: 711, avg_ms: 3448, max_ms: 120000, workspace_id: '7474658545709121' },
  { entity: 'svc-etl', queries: 76, avg_ms: 1462, max_ms: 22000, workspace_id: '7474658545709121' },
  { entity: 'alexandre.zago@demo', queries: 19, avg_ms: 10018, max_ms: 60000, workspace_id: '7474658545709121' },
];

// Compute inventory (mirrors moi_ai_catalog.lakehouse_compass.compute_inventory).
export const computeInventoryRows = [
  { workspace_id: '7474658545709121', workspace_name: 'moi-ai', kind: 'warehouse', compute_id: '4e6fdb0b5307a9f1', name: 'Serverless Starter', size: 'Small', serverless: true, auto_stop_min: 10, min_clusters: 1, max_clusters: 1, dbr_version: '', state: 'RUNNING', owner: '', queries_30d: 1373, avg_ms: 5861, p90_ms: 12712, dbus_30d: 118.4, cost_usd_30d: 82.9 },
  { workspace_id: '7474658545709121', workspace_name: 'moi-ai', kind: 'warehouse', compute_id: '01bc171682ee8634', name: 'analytics-classic', size: '2X-Small', serverless: false, auto_stop_min: 0, min_clusters: 1, max_clusters: 2, dbr_version: '', state: 'STOPPED', owner: '', queries_30d: 418, avg_ms: 7437, p90_ms: 10113, dbus_30d: 20.0, cost_usd_30d: 14.0 },
  { workspace_id: '7474658545709121', workspace_name: 'moi-ai', kind: 'cluster', compute_id: '0921-abc-interactive', name: 'ds-shared', size: '', serverless: null, auto_stop_min: 0, min_clusters: 2, max_clusters: 8, dbr_version: '12.2.x-scala2.12', state: '', owner: 'ana.silva@demo', queries_30d: 0, avg_ms: 0, p90_ms: 0, dbus_30d: 55.3, cost_usd_30d: 41.2 },
];

export const usageSummaryRows = [
  { metric: 'active_users_30d', value: 49, workspace_id: '7474658545709121' },
  { metric: 'dau', value: 2, workspace_id: '7474658545709121' },
  { metric: 'wau', value: 5, workspace_id: '7474658545709121' },
  { metric: 'mau', value: 6, workspace_id: '7474658545709121' },
  { metric: 'top_identity_share_pct', value: 86.2, workspace_id: '7474658545709121' },
  { metric: 'genie_users', value: 2, workspace_id: '7474658545709121' },
  { metric: 'genie_statements', value: 262, workspace_id: '7474658545709121' },
  { metric: 'genie_adoption_pct', value: 33.3, workspace_id: '7474658545709121' },
  { metric: 'genie_code_available', value: 0, workspace_id: '7474658545709121' },
  { metric: 'genie_code_statements', value: 0, workspace_id: '7474658545709121' },
];

export const usageActiveUsersTrendRows = [
  { period_start: '2026-08-10', active_users: 1, genie_users: 0, workspace_id: '7474658545709121' },
  { period_start: '2026-08-17', active_users: 1, genie_users: 0, workspace_id: '7474658545709121' },
  { period_start: '2026-08-24', active_users: 2, genie_users: 2, workspace_id: '7474658545709121' },
  { period_start: '2026-08-31', active_users: 1, genie_users: 1, workspace_id: '7474658545709121' },
  { period_start: '2026-09-07', active_users: 5, genie_users: 1, workspace_id: '7474658545709121' },
];

export const usageHeatmapRows = (() => {
  const out: Record<string, unknown>[] = [];
  for (let dow = 1; dow <= 7; dow++) for (let h = 8; h <= 19; h++) out.push({ dow, hour: h, n: Math.round(10 + 40 * Math.random()), workspace_id: '7474658545709121' });
  return out;
})();

export const reliabilitySummaryRows = [
  { total_runs: 27, errors: 11, succeeded: 15, failure_rate_pct: 40.7, workspace_id: '7474658545709121' },
];

export const maintenanceRows = [
  { id: 'M-2001', sourceRule: 'MNT-002', resource: 'sp: prod-etl OAuth secret', owner: 'platform@demo', dueAt: isoInDays(3), recurrence: 'on-expiry', status: 'due' },
  { id: 'M-2002', sourceRule: 'MNT-001', resource: 'job cluster: nightly-batch (DBR 13.3 EOS)', owner: 'data-eng@demo', dueAt: isoInDays(6), recurrence: 'quarterly', status: 'due' },
  { id: 'M-2003', sourceRule: 'MNT-004', resource: 'exception: SEC-018 waiver', owner: 'security@demo', dueAt: isoInDays(-2), recurrence: 'on-expiry', status: 'overdue' },
];

// Latest proactive digest (mirrors moi_ai_catalog.lakehouse_compass.digests).
export const digestsRows = [
  {
    workspace_id: '7474658545709121', workspace_name: 'moi-ai',
    generated_at: new Date().toISOString(), score: 73, score_delta: -1.2, coverage_pct: 85.7,
    crit: 3, high: 5, med: 3, low: 2,
    weakest_pillars_json: JSON.stringify([
      { pillar: 'security', score: 62, findings: 16 },
      { pillar: 'data_ai_governance', score: 70, findings: 12 },
      { pillar: 'cost_optimization', score: 74, findings: 10 },
    ]),
    limited_pillars_json: JSON.stringify(['reliability', 'performance_efficiency', 'interoperability_usability']),
    new_json: JSON.stringify(['REL-001', 'USG-010']),
    resolved_json: JSON.stringify(['FIN-028']),
    still_open_json: JSON.stringify(['SEC-014', 'SEC-030', 'AIG-004', 'LKB-002']),
    criticals_json: JSON.stringify([
      { rule_id: 'SEC-014', title: 'Broad MODIFY / ALL PRIVILEGES granted to all-account-users', resource: 'grantee: account users' },
    ]),
    narrative: 'Lakehouse Compass status for moi-ai\nHealth score 73/100 (down -1.2 since the last scan); rule coverage 85.7%.\nOpen now: 3 critical, 5 high, 3 medium.\nWeakest Well-Architected pillars: Security, Privacy & Compliance (62), Data & AI Governance (70), Cost Optimization (74).\nBarely checked yet (add rules to trust the score): Reliability, Performance Efficiency, Interoperability & Usability.\nSince last scan: 2 new, 1 resolved, 4 still open.',
  },
];

// Per-WAF-pillar sub-scores (mirrors moi_ai_catalog.lakehouse_compass.waf_scores).
// `rules` = number of Compass rules mapped to the pillar today; low counts flag
// limited coverage (Operational Excellence / Interoperability are barely checked).
export const wafScoresRows = [
  { pillar: 'security', score: 62, findings: 16, critical_findings: 3, rules: 8, workspace_id: '7474658545709121', controls_total: 12, controls_measured: 7, controls_passed: 4, low: 33.3, high: 75 },
  { pillar: 'data_ai_governance', score: 70, findings: 12, critical_findings: 1, rules: 9, workspace_id: '7474658545709121', controls_total: 8, controls_measured: 4, controls_passed: 3, low: 37.5, high: 87.5 },
  { pillar: 'cost_optimization', score: 74, findings: 10, critical_findings: 0, rules: 6, workspace_id: '7474658545709121', controls_total: 10, controls_measured: 6, controls_passed: 4, low: 40, high: 80 },
  { pillar: 'performance_efficiency', score: 83, findings: 3, critical_findings: 0, rules: 1, workspace_id: '7474658545709121', controls_total: 6, controls_measured: 1, controls_passed: 1, low: 16.7, high: 100 },
  { pillar: 'reliability', score: 90, findings: 1, critical_findings: 0, rules: 1, workspace_id: '7474658545709121', controls_total: 6, controls_measured: 1, controls_passed: 1, low: 16.7, high: 100 },
  { pillar: 'operational_excellence', score: 88, findings: 2, critical_findings: 0, rules: 3, workspace_id: '7474658545709121', controls_total: 7, controls_measured: 2, controls_passed: 2, low: 28.6, high: 100 },
  { pillar: 'interoperability_usability', score: 95, findings: 1, critical_findings: 0, rules: 2, workspace_id: '7474658545709121', controls_total: 7, controls_measured: 2, controls_passed: 2, low: 28.6, high: 100 },
];

// WAF control outcomes for the drill-down (mirrors moi_ai_catalog.lakehouse_compass.waf_controls).
export const wafControlsRows = [
  { pillar: 'security', control_id: 'SCP-IAM-02', title: 'Least-privilege service principals', principle: 'Identity & access management', provenance: 'waf-docs', measurability: 'system_table', severity: 'high', status: 'gap', measured: true, rule_id: 'SEC-027', remediation: 'Revoke ALL PRIVILEGES; grant the minimum on specific schemas/tables.', doc_url: 'https://docs.databricks.com/en/data-governance/unity-catalog/manage-privileges/index.html', workspace_id: '7474658545709121' },
  { pillar: 'security', control_id: 'SCP-IAM-04', title: 'OAuth over personal access tokens', principle: 'Identity & access management', provenance: 'security-guide', measurability: 'system_table', severity: 'medium', status: 'gap', measured: true, rule_id: 'SEC-029', remediation: 'Disable PATs or cap lifetime; migrate integrations to OAuth.', doc_url: 'https://docs.databricks.com/en/security/auth/index.html', workspace_id: '7474658545709121' },
  { pillar: 'security', control_id: 'SCP-IAM-01', title: 'Single sign-on and automated provisioning (SSO + SCIM)', principle: 'Identity & access management', provenance: 'security-guide', measurability: 'attestation', severity: 'high', status: 'attestation', measured: false, rule_id: '', remediation: 'Federate identity via SSO and provision users/groups with SCIM from the IdP.', doc_url: 'https://docs.databricks.com/en/security/auth/index.html', workspace_id: '7474658545709121' },
  { pillar: 'security', control_id: 'SCP-NET-01', title: 'Private connectivity and IP access lists', principle: 'Networking', provenance: 'security-guide', measurability: 'attestation', severity: 'high', status: 'attestation', measured: false, rule_id: '', remediation: 'Enable PrivateLink / serverless egress controls and IP access lists.', doc_url: 'https://docs.databricks.com/en/security/network/index.html', workspace_id: '7474658545709121' },
  { pillar: 'data_ai_governance', control_id: 'DG-META-01', title: 'Tables carry descriptions', principle: 'Metadata & discoverability', provenance: 'waf-docs', measurability: 'system_table', severity: 'medium', status: 'gap', measured: true, rule_id: 'GOV-025', remediation: 'Add descriptions to the most-queried tables; enforce coverage on gold assets.', doc_url: 'https://docs.databricks.com/en/data-governance/unity-catalog/index.html', workspace_id: '7474658545709121' },
  { pillar: 'data_ai_governance', control_id: 'DG-LIN-01', title: 'Data and model lineage captured', principle: 'Lineage & auditability', provenance: 'waf-docs', measurability: 'attestation', severity: 'medium', status: 'attestation', measured: false, rule_id: '', remediation: 'Rely on UC automatic lineage; ensure jobs/notebooks run under UC.', doc_url: 'https://docs.databricks.com/en/data-governance/unity-catalog/data-lineage.html', workspace_id: '7474658545709121' },
  { pillar: 'cost_optimization', control_id: 'CO-AI-01', title: 'AI serving endpoints have spend caps', principle: 'Cost controls', provenance: 'waf-docs', measurability: 'system_table', severity: 'high', status: 'gap', measured: true, rule_id: 'FIN-028', remediation: 'Set AI Gateway budgets / rate limits and a spend cap per endpoint.', doc_url: 'https://docs.databricks.com/en/ai-gateway/index.html', workspace_id: '7474658545709121' },
  { pillar: 'cost_optimization', control_id: 'CO-ATTR-01', title: 'Spend is attributed via tags', principle: 'Cost controls', provenance: 'waf-docs', measurability: 'system_table', severity: 'high', status: 'gap', measured: true, rule_id: 'FIN-027', remediation: 'Adopt a cost-tag policy; set run-as identities; enable Gateway budgets.', doc_url: 'https://docs.databricks.com/en/admin/account-settings/usage.html', workspace_id: '7474658545709121' },
  { pillar: 'cost_optimization', control_id: 'CO-COMP-01', title: 'Serverless / autoscaling compute preferred', principle: 'Right-sizing', provenance: 'waf-docs', measurability: 'system_table', severity: 'medium', status: 'pass', measured: true, rule_id: 'FIN-029', remediation: 'Enable scale-to-zero and autoscaling; prune idle branches/snapshots.', doc_url: 'https://docs.databricks.com/en/compute/index.html', workspace_id: '7474658545709121' },
  { pillar: 'security', control_id: 'SCP-IAM-05', title: 'Broad privileges not granted to account-users', principle: 'Identity & access management', provenance: 'security-guide', measurability: 'system_table', severity: 'critical', status: 'pass', measured: true, rule_id: 'SEC-014', remediation: 'Revoke broad privileges from `account users`; grant the minimum to specific teams/SPs.', doc_url: 'https://docs.databricks.com/en/data-governance/unity-catalog/manage-privileges/index.html', workspace_id: '7474658545709121' },
  { pillar: 'reliability', control_id: 'REL-DR-01', title: 'DR with defined and tested RTO/RPO', principle: 'Disaster recovery', provenance: 'waf-docs', measurability: 'attestation', severity: 'high', status: 'attestation', measured: false, rule_id: '', remediation: 'Define and test a DR plan (RTO/RPO) with metadata and table replication.', doc_url: 'https://docs.databricks.com/en/admin/disaster-recovery.html', workspace_id: '7474658545709121' },
  { pillar: 'performance_efficiency', control_id: 'PE-OPT-01', title: 'Predictive Optimization enabled', principle: 'Data layout', provenance: 'waf-docs', measurability: 'attestation', severity: 'medium', status: 'attestation', measured: false, rule_id: '', remediation: 'Enable Predictive Optimization so OPTIMIZE/VACUUM run automatically.', doc_url: 'https://docs.databricks.com/en/optimizations/predictive-optimization.html', workspace_id: '7474658545709121' },
  { pillar: 'operational_excellence', control_id: 'OE-CICD-01', title: 'CI/CD with Databricks Asset Bundles / IaC', principle: 'CI/CD & IaC', provenance: 'waf-docs', measurability: 'attestation', severity: 'high', status: 'attestation', measured: false, rule_id: '', remediation: 'Standardize on DABs + CI/CD; manage infra as code.', doc_url: 'https://docs.databricks.com/en/dev-tools/bundles/index.html', workspace_id: '7474658545709121' },
  { pillar: 'interoperability_usability', control_id: 'IU-FMT-01', title: 'Open table formats (Delta / UniForm / Iceberg)', principle: 'Open formats', provenance: 'waf-docs', measurability: 'attestation', severity: 'medium', status: 'attestation', measured: false, rule_id: '', remediation: 'Standardize on Delta; enable UniForm for Iceberg/Hudi interoperability.', doc_url: 'https://docs.databricks.com/en/delta/uniform.html', workspace_id: '7474658545709121' },
];

// Genie Ontology Readiness — summary (mirrors moi_ai_catalog.lakehouse_compass.genie_readiness).
export const genieReadinessRows = [
  {
    workspace_id: '7474658545709121',
    workspace_name: 'moi-ai',
    overall_score: 47.8,
    level: 2,
    level_label: 'Developing',
    readiness_stage: 'Core foundation in place',
    guidance: 'Focus next on Metrics, Domains & Stewardship, and Metadata Richness: your lowest-scoring, highest-impact areas.',
    top_gaps_json: JSON.stringify([
      { pillar: 'Metrics', gap: 'No metric views found. Metric views are the GA foundation that feeds Genie Ontology — define KPIs centrally here.' },
      { pillar: 'Domains & Stewardship', gap: 'No domain-style governed tags found (e.g. a `domain` tag). Organize assets into business-aligned domains.' },
      { pillar: 'Domains & Stewardship', gap: 'No certified assets found — certify canonical gold tables so users (and Genie) know which to trust.' },
      { pillar: 'Metadata Richness', gap: 'Only 44% of tables have descriptions — Genie relies on these to understand data.' },
      { pillar: 'Relationships & Modeling', gap: 'No foreign-key constraints declared; PK/FK relationships let Genie infer joins reliably.' },
      { pillar: 'Genie Agents', gap: '2 Genie Agent(s) exist but none were active in the last 30 days — drive adoption or retire stale agents.' },
    ]),
    pillars_available: 7,
    assessed_at: new Date().toISOString(),
  },
];

// Genie Ontology Readiness — per-pillar (mirrors genie_readiness_pillars).
export const genieReadinessPillarsRows = [
  {
    workspace_id: '7474658545709121', workspace_name: 'moi-ai', pillar_key: 'uc_foundation',
    name: 'Unity Catalog Foundation', weight: 15, score: 85, technical_score: 85, level: 4,
    level_label: 'Optimized', available: true, unavailable_reason: null,
    signals_json: JSON.stringify([
      { label: 'Catalogs', value: 6, detail: 'User catalogs assessed' },
      { label: 'Schemas', value: 38, detail: 'Excluding information_schema' },
      { label: 'Tables', value: 214, detail: 'Tables in Unity Catalog' },
    ]),
    gaps_json: JSON.stringify([]),
    metrics_json: JSON.stringify({ catalogs: 6, schemas: 38, tables: 214 }),
  },
  {
    workspace_id: '7474658545709121', workspace_name: 'moi-ai', pillar_key: 'metadata',
    name: 'Metadata Richness', weight: 22, score: 44, technical_score: 44, level: 2,
    level_label: 'Developing', available: true, unavailable_reason: null,
    signals_json: JSON.stringify([
      { label: 'Tables commented', value: 44, unit: '%', detail: '94 of 214 tables' },
      { label: 'Columns commented', value: 44, unit: '%', detail: '812 of 1846 columns' },
      { label: 'Tagged tables', value: 3, detail: 'Tables with ≥1 governed tag' },
    ]),
    gaps_json: JSON.stringify([
      'Only 44% of tables have descriptions — Genie relies on these to understand data.',
      'Only 44% of columns are commented; aim for high coverage on gold-layer columns.',
    ]),
    metrics_json: JSON.stringify({ table_comment_pct: 44, column_comment_pct: 44, tagged_tables: 3 }),
  },
  {
    workspace_id: '7474658545709121', workspace_name: 'moi-ai', pillar_key: 'relationships',
    name: 'Relationships & Modeling', weight: 12, score: 65, technical_score: 65, level: 3,
    level_label: 'Established', available: true, unavailable_reason: null,
    signals_json: JSON.stringify([
      { label: 'Gold-layer tables', value: 18, detail: 'Tables in gold/mart/analytics-style schemas' },
      { label: 'Primary keys', value: 12, detail: 'Declared PK constraints' },
      { label: 'Foreign keys', value: 0, detail: 'Declared FK constraints' },
    ]),
    gaps_json: JSON.stringify([
      'No foreign-key constraints declared; PK/FK relationships let Genie infer joins reliably.',
    ]),
    metrics_json: JSON.stringify({ primary_keys: 12, foreign_keys: 0, gold_tables: 18, constraints_available: true }),
  },
  {
    workspace_id: '7474658545709121', workspace_name: 'moi-ai', pillar_key: 'metrics',
    name: 'Metrics', weight: 20, score: 0, technical_score: 0, level: 0,
    level_label: 'Absent', available: true, unavailable_reason: null,
    signals_json: JSON.stringify([{ label: 'Metric views', value: 0, detail: 'UC metric views' }]),
    gaps_json: JSON.stringify([
      'No metric views found. Metric views are the GA foundation that feeds Genie Ontology — define KPIs centrally here.',
    ]),
    metrics_json: JSON.stringify({ metric_views: 0 }),
  },
  {
    workspace_id: '7474658545709121', workspace_name: 'moi-ai', pillar_key: 'genie_agents',
    name: 'Genie Agents', weight: 16, score: 40, technical_score: 40, level: 2,
    level_label: 'Developing', available: true, unavailable_reason: null,
    signals_json: JSON.stringify([
      { label: 'Genie Agents', value: 2, detail: 'Distinct agents in the audit log (30d)' },
      { label: 'Active agents (30d)', value: 0, detail: 'Distinct agents active in the last 30 days' },
    ]),
    gaps_json: JSON.stringify([
      '2 Genie Agent(s) exist but none were active in the last 30 days — drive adoption or retire stale agents.',
    ]),
    metrics_json: JSON.stringify({ genie_agents: 2, active_30d: 0 }),
  },
  {
    workspace_id: '7474658545709121', workspace_name: 'moi-ai', pillar_key: 'domains',
    name: 'Domains & Stewardship', weight: 10, score: 20, technical_score: 20, level: 1,
    level_label: 'Initial', available: true, unavailable_reason: null,
    signals_json: JSON.stringify([
      { label: 'Distinct domains (via tags)', value: 0, detail: 'Distinct domain-style tag values' },
      { label: 'Stewarded assets', value: 4, detail: 'Assets with an owner/steward tag' },
      { label: 'Certified assets', value: 0, detail: 'Tables tagged certification_status = certified' },
    ]),
    gaps_json: JSON.stringify([
      'No domain-style governed tags found (e.g. a `domain` tag). Organize assets into business-aligned domains.',
      'No certified assets found — certify canonical gold tables so users (and Genie) know which to trust.',
    ]),
    metrics_json: JSON.stringify({ distinct_domains: 0, stewarded_assets: 4, certified_assets: 0, pct_tagged: 8.4 }),
  },
  {
    workspace_id: '7474658545709121', workspace_name: 'moi-ai', pillar_key: 'adoption',
    name: 'Adoption & Activity', weight: 5, score: 95, technical_score: 95, level: 4,
    level_label: 'Optimized', available: true, unavailable_reason: null,
    signals_json: JSON.stringify([
      { label: 'Active users (30d)', value: 49, detail: 'Distinct users in audit log' },
      { label: 'Queries (30d)', value: 3184, detail: 'Query history volume' },
    ]),
    gaps_json: JSON.stringify([]),
    metrics_json: JSON.stringify({ active_users_30d: 49, queries_30d: 3184 }),
  },
];

// Genie cost & consumption — summary (mirrors genie_cost_summary). One row/ws.
export const genieCostSummaryRows = [
  {
    workspace_id: '7474658545709121',
    workspace_name: 'moi-ai',
    window_days: 30,
    billed_cost_usd: 46.29,
    billed_dbus: 661.23,
    free_dbus: 369.52,
    active_users: 4,
    code_free_dbus: 269.06,
    code_billed_dbus: 661.23,
    code_total_dbus: 930.29,
    code_billed_cost_usd: 46.29,
    code_users: 4,
    by_surface_json: JSON.stringify([
      { surface: 'GENIE_CODE', list_cost: 46.29, free_dbus: 269.06, billed_dbus: 661.23, dbus: 930.29 },
      { surface: 'GENIE_AGENTS', list_cost: 0, free_dbus: 100.46, billed_dbus: 0, dbus: 100.46 },
    ]),
    by_channel_json: JSON.stringify([
      { channel: 'UI', dbus: 661.23 },
      { channel: 'API', dbus: 0 },
    ]),
    by_sku_json: JSON.stringify([
      { sku: 'ENTERPRISE_SERVERLESS_REAL_TIME_INFERENCE_US_EAST_OHIO', dbus: 661.23 },
      { sku: 'GENIE_FREE_USAGE', dbus: 369.52 },
    ]),
    trend_json: JSON.stringify([
      { usage_date: isoInDays(-6), list_cost: 5.1 },
      { usage_date: isoInDays(-5), list_cost: 6.8 },
      { usage_date: isoInDays(-4), list_cost: 4.2 },
      { usage_date: isoInDays(-3), list_cost: 9.1 },
      { usage_date: isoInDays(-2), list_cost: 7.4 },
      { usage_date: isoInDays(-1), list_cost: 8.0 },
      { usage_date: isoInDays(0), list_cost: 5.7 },
    ]),
  },
];

// Genie cost & consumption — per-user free-vs-billed (mirrors genie_cost_by_user).
export const genieCostByUserRows = [
  {
    workspace_id: '7474658545709121', workspace_name: 'moi-ai',
    run_as_user: 'moises.santos@databricks.com', genie_surface: 'GENIE_CODE',
    free_dbus: 150, paid_dbus: 512.4, billed_cost_usd: 35.87, free_allowance_limit: 150, over_allowance: true,
  },
  {
    workspace_id: '7474658545709121', workspace_name: 'moi-ai',
    run_as_user: 'ana.silva@databricks.com', genie_surface: 'GENIE_CODE',
    free_dbus: 150, paid_dbus: 80.4, billed_cost_usd: 5.63, free_allowance_limit: 150, over_allowance: true,
  },
  {
    workspace_id: '7474658545709121', workspace_name: 'moi-ai',
    run_as_user: 'carlos.rocha@databricks.com', genie_surface: 'GENIE_AGENTS',
    free_dbus: 91.15, paid_dbus: 0, billed_cost_usd: 0, free_allowance_limit: null, over_allowance: false,
  },
];

// Genie cost evolutionary series — 365 daily points (mirrors genie_cost_trend),
// deterministic so the demo view is stable across restarts.
export const genieCostTrendRows = Array.from({ length: 365 }, (_, k) => {
  const i = 364 - k; // days ago (oldest first)
  const ramp = i > 180 ? 0.3 : i > 90 ? 0.9 : 1.7;
  const wave = 0.5 * Math.abs(Math.sin(i / 9));
  const billed = Math.round((ramp + wave) * 100) / 100;
  return {
    workspace_id: '7474658545709121',
    workspace_name: 'moi-ai',
    usage_date: isoInDays(-i),
    billed_cost_usd: billed,
    billed_dbus: Math.round(billed * 14.3 * 100) / 100,
    free_dbus: Math.round((6 + 4 * Math.abs(Math.sin(i / 5))) * 100) / 100,
  };
});

// FinOps cost evolutionary series — 365 daily points × a few products (mirrors
// cost_trend), deterministic for a stable demo view.
export const costTrendRows = (() => {
  const products = [
    { product: 'APPS', base: 55, amp: 20 },
    { product: 'LAKEBASE', base: 30, amp: 12 },
    { product: 'SQL', base: 18, amp: 10 },
    { product: 'JOBS', base: 12, amp: 8 },
    { product: 'MODEL_SERVING', base: 6, amp: 5 },
  ];
  const rows: Record<string, unknown>[] = [];
  for (let k = 0; k < 365; k++) {
    const i = 364 - k; // days ago (oldest first)
    const ramp = i > 180 ? 0.5 : i > 90 ? 0.8 : 1.3;
    for (const p of products) {
      const cost = Math.round((p.base * ramp + p.amp * Math.abs(Math.sin((i + p.base) / 11))) * 100) / 100;
      rows.push({
        workspace_id: '7474658545709121', workspace_name: 'moi-ai',
        usage_date: isoInDays(-i), product: p.product,
        cost_usd: cost, dbus: Math.round(cost * 1.4 * 100) / 100,
      });
    }
  }
  return rows;
})();

function isoInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
