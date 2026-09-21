import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runSql } from '../lib/dbx';

const CAT = 'moi_ai_catalog.lakehouse_compass';

// Static rule catalog (mirrors packages/compass_core/rules/definitions/*.yaml) for
// get_rule / search_docs — the only place the agent may surface docs URLs.
export const RULE_CATALOG: Record<string, { title: string; severity: string; domain: string; remediation: string; docs: string[] }> = {
  'SEC-014': { title: 'Broad privileges granted to all-account-users groups', severity: 'critical', domain: 'security', remediation: 'REVOKE the broad privilege from `account users`; grant the minimum to specific teams/SPs.', docs: ['https://docs.databricks.com/data-governance/unity-catalog/manage-privileges/'] },
  'SEC-027': { title: 'App/agent service principal holds MANAGE/ALL PRIVILEGES on a catalog', severity: 'critical', domain: 'security', remediation: 'REVOKE ALL PRIVILEGES ON CATALOG; GRANT only USE/SELECT on required schemas.', docs: ['https://docs.databricks.com/data-governance/unity-catalog/manage-privileges/'] },
  'SEC-029': { title: 'Workspace still allows PATs where OAuth is feasible', severity: 'high', domain: 'security', remediation: 'Disable PATs or cap lifetime; migrate integrations to OAuth.', docs: ['https://docs.databricks.com/dev-tools/auth/'] },
  'SEC-030': { title: 'ABAC tagging privileges granted broadly', severity: 'high', domain: 'security', remediation: 'Restrict APPLY TAG / ASSIGN to the data-governance stewardship group.', docs: ['https://docs.databricks.com/data-governance/unity-catalog/tags.html'] },
  'FIN-027': { title: 'Spend without user/team/use-case attribution', severity: 'high', domain: 'finops', remediation: 'Adopt a cost-tag policy; set run-as identities; enable Gateway budgets.', docs: ['https://docs.databricks.com/admin/account-settings/usage.html'] },
  'FIN-028': { title: 'Serving endpoints without spend caps', severity: 'high', domain: 'finops', remediation: 'Configure a spend cap/budget via Unity AI Gateway; enable usage tracking.', docs: ['https://docs.databricks.com/ai-gateway/'] },
  'FIN-029': { title: 'Lakebase idle projects or non-scale-to-zero compute', severity: 'medium', domain: 'finops', remediation: 'Enable scale-to-zero; prune idle branches/snapshots.', docs: ['https://docs.databricks.com/oltp/'] },
  'FIN-030': { title: 'Genie consumption without free-allowance attribution', severity: 'medium', domain: 'finops', remediation: 'Attribute Genie usage to named users; review SP-driven Genie traffic.', docs: ['https://docs.databricks.com/genie/'] },
  'AIG-003': { title: 'Endpoints without budget/spend cap; unattributed AI spend', severity: 'high', domain: 'ai_estate', remediation: 'Front with Unity AI Gateway; enable usage tracking + payload logging; set budgets and a spend cap.', docs: ['https://docs.databricks.com/ai-gateway/'] },
  'AIG-004': { title: 'User-facing endpoints without input/output guardrails', severity: 'high', domain: 'ai_estate', remediation: 'Enable input/output guardrails (PII, prompt-injection, content policy) on the Gateway endpoint.', docs: ['https://docs.databricks.com/ai-gateway/guardrails.html'] },
  'GEN-013': { title: 'Genie Agents built on tables without certified metric views', severity: 'medium', domain: 'genie', remediation: 'Define & certify UC metric views for core metrics; add to the Genie Agent.', docs: ['https://docs.databricks.com/genie/'] },
  'LKB-001': { title: 'Native password authentication enabled on Lakebase', severity: 'high', domain: 'lakebase', remediation: 'Disable native password auth; use OAuth tokens rotated by the pool.', docs: ['https://docs.databricks.com/oltp/'] },
  'LKB-002': { title: 'App/agent Lakebase roles with owner/superuser privileges', severity: 'high', domain: 'lakebase', remediation: 'Create a least-privilege role scoped to the app schema (no OWNER/SUPERUSER).', docs: ['https://docs.databricks.com/oltp/'] },
};

const NAMED_QUERIES = new Set(['scores', 'findings', 'cost_summary', 'compliance', 'capabilities', 'trend', 'reports']);

// Severity → base priority weight (mirrors compass_core scoring intent).
const SEV_WEIGHT: Record<string, number> = { critical: 100, high: 60, medium: 25, low: 8, info: 1 };

// Short WAF pillar labels for plan rationale (client localizes its own copy).
const PILLAR_LABEL: Record<string, string> = {
  operational_excellence: 'Operational Excellence',
  security: 'Security',
  reliability: 'Reliability',
  performance_efficiency: 'Performance Efficiency',
  cost_optimization: 'Cost Optimization',
  data_ai_governance: 'Data & AI Governance',
  interoperability_usability: 'Interoperability & Usability',
};

function toPillars(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String) : []; } catch { return []; }
  }
  return [];
}

export interface PlanItem {
  rank: number;
  finding_id: string;
  rule_id: string;
  severity: string;
  title: string;
  resource: string;
  priority: number;
  weakest_pillar: string;
  weakest_pillar_score: number | null;
  rationale: string;
  remediation: string;
}

/**
 * Deterministic remediation triage: rank open findings by severity, boosted by
 * how weak the Well-Architected pillar(s) they touch are (a critical on the
 * weakest pillar tops the list). Read-only — the advisor's prioritized plan.
 */
export async function buildRemediationPlan(ws: string): Promise<PlanItem[]> {
  const w = wsSafe(ws);
  const wc = w ? `AND t.workspace_id='${w}'` : '';
  const findings = await runSql(
    `SELECT t.finding_id, t.rule_id, t.domain, t.severity, t.title, t.resource, t.waf_pillars ` +
    `FROM ${CAT}.findings t WHERE t.scan_id=${latest('findings', ws)} ${wc} AND t.status='open'`
  );
  const wafRows = await runSql(
    `SELECT t.pillar, t.score FROM ${CAT}.waf_scores t WHERE t.scan_id=${latest('waf_scores', ws)} ${wc}`
  );
  const pillarScore = new Map<string, number>();
  for (const r of wafRows as Record<string, unknown>[]) pillarScore.set(String(r.pillar), Number(r.score));

  const items = (findings as Record<string, unknown>[]).map((f) => {
    const sev = String(f.severity || '').toLowerCase();
    const sevW = SEV_WEIGHT[sev] ?? 1;
    let weakest = 101;
    let weakestPillar = '';
    for (const p of toPillars(f.waf_pillars)) {
      const s = pillarScore.get(p);
      if (s !== undefined && s < weakest) { weakest = s; weakestPillar = p; }
    }
    const hasPillar = weakestPillar !== '';
    const pressure = hasPillar ? (100 - weakest) / 100 : 0; // 0..1
    const priority = Math.round(sevW + pressure * 40);
    const rule = RULE_CATALOG[String(f.rule_id)];
    const sevLabel = sev.charAt(0).toUpperCase() + sev.slice(1);
    const rationale = hasPillar
      ? `${sevLabel} severity; weakest pillar ${PILLAR_LABEL[weakestPillar] || weakestPillar} (${weakest}).`
      : `${sevLabel} severity.`;
    return {
      finding_id: String(f.finding_id), rule_id: String(f.rule_id), severity: sev,
      title: String(f.title || ''), resource: String(f.resource || ''),
      priority, weakest_pillar: weakestPillar, weakest_pillar_score: hasPillar ? weakest : null,
      rationale, remediation: rule?.remediation || '',
    };
  });
  items.sort((a, b) => b.priority - a.priority);
  return items.map((it, i) => ({ rank: i + 1, ...it }));
}

/**
 * Draft a ProposedChange for a finding and persist it for human approval.
 * Shared by the agent's draft_proposed_change tool and the one-click draft
 * endpoint. Never executes anything.
 */
export async function draftChange(findingId: string, user: string, ws: string): Promise<Record<string, unknown>> {
  const w = wsSafe(ws);
  const found = await runSql(`SELECT finding_id, rule_id, title, resource, remediation, workspace_id FROM ${CAT}.findings t WHERE t.finding_id='${esc(findingId)}' LIMIT 1`);
  if (!found.length) return { error: 'finding not found' };
  const f = found[0] as Record<string, string>;
  const rule = RULE_CATALOG[f.rule_id] || { remediation: String(f.remediation || ''), title: String(f.title || '') };
  const changeId = `pc-${Date.now()}`;
  const steps = `1. Review ${f.rule_id} on ${f.resource}. 2. ${rule.remediation} 3. Re-run the Compass scan to verify resolution.`;
  const code = String(rule.remediation || f.remediation || '');
  const rollback = 'Re-apply the previous grant/config if the change causes access regressions.';
  const blast = f.rule_id.startsWith('SEC') ? 'High — affects access control' : 'Medium';
  await runSql(
    `INSERT INTO ${CAT}.proposed_changes VALUES ('${changeId}','${esc(findingId)}','${esc(f.rule_id)}','${esc(String(f.workspace_id || w))}','${esc('Remediate ' + f.rule_id)}','${esc(steps)}','${esc(code)}','${esc(rollback)}','${esc(blast)}','MEDIUM','NEEDS_INFO','${esc(user)}','${new Date().toISOString()}',NULL,NULL)`
  );
  return { change_id: changeId, finding_id: findingId, rule_id: f.rule_id, status: 'NEEDS_INFO', steps, rollback, blast_radius: blast, note: 'Draft stored for human approval — Compass never executes changes.' };
}

function wsSafe(ws: string): string {
  return /^[0-9]+$/.test(ws) ? ws : '';
}
function esc(s: string): string {
  return String(s).replace(/'/g, "''");
}
function latest(table: string, ws: string): string {
  const w = wsSafe(ws);
  const lclause = w ? `WHERE workspace_id='${w}'` : '';
  return `(SELECT MAX(scan_id) FROM ${CAT}.${table} ${lclause})`;
}

// ---- OpenAI-format tool specs (all read-only; draft_proposed_change writes only to proposed_changes) ----
export const TOOL_SPECS = [
  { type: 'function', function: { name: 'get_findings', description: 'List findings for the selected workspace, optionally filtered by domain or severity.', parameters: { type: 'object', properties: { domain: { type: 'string' }, severity: { type: 'string' } } } } },
  { type: 'function', function: { name: 'get_finding', description: 'Get one finding by finding_id.', parameters: { type: 'object', properties: { finding_id: { type: 'string' } }, required: ['finding_id'] } } },
  { type: 'function', function: { name: 'get_rule', description: 'Get a rule definition (title, severity, remediation, docs) by rule_id.', parameters: { type: 'object', properties: { rule_id: { type: 'string' } }, required: ['rule_id'] } } },
  { type: 'function', function: { name: 'get_scores', description: 'Get overall + per-domain scores and coverage for the selected workspace.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_capabilities', description: 'Get capability availability (AVAILABLE/NOT_AVAILABLE) for the selected workspace.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_cost_summary', description: 'Get cost by product (and unattributed share) for the selected workspace.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_compliance', description: 'Get dbx-security-best-practices control statuses for the selected workspace.', parameters: { type: 'object', properties: { framework: { type: 'string' } } } } },
  { type: 'function', function: { name: 'run_named_query', description: 'Run a whitelisted named query (scores, findings, cost_summary, compliance, capabilities, trend, reports) for the selected workspace.', parameters: { type: 'object', properties: { query_id: { type: 'string' } }, required: ['query_id'] } } },
  { type: 'function', function: { name: 'propose_remediation_plan', description: 'Return a prioritized remediation plan for the selected workspace: open findings ranked by severity and how weak the Well-Architected pillar they touch is. Use this to triage what to fix first.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'draft_proposed_change', description: 'Draft a ProposedChange (steps, code, rollback, blast radius) for a finding and persist it for human approval. Never executes.', parameters: { type: 'object', properties: { finding_id: { type: 'string' } }, required: ['finding_id'] } } },
  { type: 'function', function: { name: 'search_docs', description: 'Return Databricks docs URLs from the rule catalog and WAF controls matching a topic.', parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] } } },
  { type: 'function', function: { name: 'get_waf_control', description: 'Get one Well-Architected control by control_id (e.g. CO-ATTR-01): pillar, principle, title, severity, status, remediation, doc_url and mapped rule_id.', parameters: { type: 'object', properties: { control_id: { type: 'string' } }, required: ['control_id'] } } },
  { type: 'function', function: { name: 'get_waf_controls', description: 'List Well-Architected controls for the selected workspace at the latest scan, optionally filtered by pillar and/or status (pass, gap, attestation). Use for "how do I improve <pillar>" / control-gap questions.', parameters: { type: 'object', properties: { pillar: { type: 'string' }, status: { type: 'string' } } } } },
  { type: 'function', function: { name: 'get_waf_pillars', description: 'Get per-pillar Well-Architected band scores (score + controls total/measured/passed + low/high band) for the selected workspace. Use for pillar-level context.', parameters: { type: 'object', properties: {} } } },
];

export async function executeTool(name: string, args: Record<string, unknown>, ws: string, user: string): Promise<unknown> {
  const w = wsSafe(ws);
  switch (name) {
    case 'get_findings': {
      const conds = [`t.scan_id=${latest('findings', ws)}`];
      if (w) conds.push(`t.workspace_id='${w}'`);
      if (typeof args.domain === 'string') conds.push(`t.domain='${esc(args.domain)}'`);
      if (typeof args.severity === 'string') conds.push(`t.severity='${esc(args.severity)}'`);
      return runSql(`SELECT t.finding_id, t.rule_id, t.domain, t.severity, t.title, t.resource, t.status FROM ${CAT}.findings t WHERE ${conds.join(' AND ')} ORDER BY t.rule_id`);
    }
    case 'get_finding':
      return runSql(`SELECT t.finding_id, t.rule_id, t.domain, t.severity, t.title, t.resource, t.status, t.evidence_json, t.remediation, t.framework_controls FROM ${CAT}.findings t WHERE t.finding_id='${esc(String(args.finding_id))}' LIMIT 1`);
    case 'get_rule': {
      const r = RULE_CATALOG[String(args.rule_id)];
      return r ? { rule_id: args.rule_id, ...r } : { error: 'unknown rule_id' };
    }
    case 'get_scores':
      return runSql(`SELECT t.domain, t.weight, t.score, t.findings, t.critical_findings, t.is_overall, t.coverage_pct FROM ${CAT}.scores t WHERE t.scan_id=${latest('scores', ws)} ${w ? `AND t.workspace_id='${w}'` : ''}`);
    case 'get_capabilities':
      return runSql(`SELECT t.capability_id, t.source, t.availability FROM ${CAT}.capabilities t WHERE t.scan_id=${latest('capabilities', ws)} ${w ? `AND t.workspace_id='${w}'` : ''}`);
    case 'get_cost_summary':
      return runSql(`SELECT t.product, ROUND(SUM(t.cost_usd),2) AS cost_usd, MAX(CASE WHEN t.identity='(unattributed)' THEN 1 ELSE 0 END) AS has_unattributed FROM ${CAT}.cost_summary t WHERE t.scan_id=${latest('cost_summary', ws)} ${w ? `AND t.workspace_id='${w}'` : ''} GROUP BY t.product ORDER BY cost_usd DESC`);
    case 'get_compliance':
      return runSql(`SELECT t.control_id, t.title, t.category, t.status FROM ${CAT}.compliance_results t WHERE t.scan_id=${latest('compliance_results', ws)} ${w ? `AND t.workspace_id='${w}'` : ''}`);
    case 'get_maintenance':
      return [{ note: 'Maintenance tasks are not yet materialized to Delta in this phase.' }];
    case 'run_named_query': {
      const id = String(args.query_id);
      if (!NAMED_QUERIES.has(id)) return { error: 'query not whitelisted' };
      let sqlText: string;
      try {
        sqlText = readFileSync(path.join(process.cwd(), 'config', 'queries', `${id}.sql`), 'utf-8');
      } catch {
        return { error: 'query file not found' };
      }
      // Only :p_ws is substituted, with a validated numeric workspace id.
      sqlText = sqlText.replace(/:p_ws/g, `'${w}'`);
      const rows = await runSql(sqlText);
      return rows.slice(0, 50);
    }
    case 'propose_remediation_plan':
      return (await buildRemediationPlan(ws)).slice(0, 25);
    case 'draft_proposed_change':
      return draftChange(String(args.finding_id), user, ws);
    case 'get_waf_control':
      return runSql(`SELECT t.control_id, t.pillar, t.principle, t.title, t.severity, t.status, t.remediation, t.doc_url, t.rule_id FROM ${CAT}.waf_controls t WHERE t.scan_id=${latest('waf_controls', ws)} ${w ? `AND t.workspace_id='${w}'` : ''} AND t.control_id='${esc(String(args.control_id))}' LIMIT 1`);
    case 'get_waf_controls': {
      const conds = [`t.scan_id=${latest('waf_controls', ws)}`];
      if (w) conds.push(`t.workspace_id='${w}'`);
      if (typeof args.pillar === 'string') conds.push(`t.pillar='${esc(args.pillar)}'`);
      if (typeof args.status === 'string') conds.push(`t.status='${esc(args.status)}'`);
      return runSql(`SELECT t.control_id, t.pillar, t.principle, t.title, t.severity, t.status, t.remediation, t.doc_url, t.rule_id FROM ${CAT}.waf_controls t WHERE ${conds.join(' AND ')} ORDER BY t.pillar, t.control_id LIMIT 60`);
    }
    case 'get_waf_pillars':
      return runSql(`SELECT t.pillar, t.score, t.controls_total, t.controls_measured, t.controls_passed, t.low, t.high FROM ${CAT}.waf_scores t WHERE t.scan_id=${latest('waf_scores', ws)} ${w ? `AND t.workspace_id='${w}'` : ''} ORDER BY t.pillar`);
    case 'search_docs': {
      const topic = String(args.topic || '').toLowerCase();
      const ruleHits = Object.entries(RULE_CATALOG)
        .filter(([id, r]) => (id + ' ' + r.title + ' ' + r.domain).toLowerCase().includes(topic))
        .flatMap(([id, r]) => r.docs.map((u) => ({ rule_id: id, url: u })));
      let wafHits: { control_id: string; url: string }[] = [];
      if (topic) {
        const like = `%${esc(topic)}%`;
        const rows = await runSql(
          `SELECT t.control_id, t.doc_url FROM ${CAT}.waf_controls t WHERE t.scan_id=${latest('waf_controls', ws)} ${w ? `AND t.workspace_id='${w}'` : ''} AND t.doc_url IS NOT NULL AND t.doc_url<>'' AND (LOWER(t.control_id) LIKE '${like}' OR LOWER(t.title) LIKE '${like}' OR LOWER(t.pillar) LIKE '${like}' OR LOWER(t.principle) LIKE '${like}') ORDER BY t.pillar, t.control_id LIMIT 8`
        );
        wafHits = (rows as Record<string, unknown>[]).map((r) => ({ control_id: String(r.control_id), url: String(r.doc_url) }));
      }
      const seen = new Set<string>();
      const out: ({ rule_id: string; url: string } | { control_id: string; url: string })[] = [];
      for (const h of [...ruleHits, ...wafHits]) {
        if (seen.has(h.url)) continue;
        seen.add(h.url);
        out.push(h);
        if (out.length >= 8) break;
      }
      return out;
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}
