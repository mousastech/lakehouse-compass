// Synthetic demo fixtures for Phase 0. These let the app render a complete,
// meaningful Overview with zero external dependencies (DEMO_MODE). They mirror
// the shape that the scan job writes to main.lakehouse_compass.* Delta tables,
// so the same client renders live data once resources are attached.

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type DomainId =
  | 'security'
  | 'finops'
  | 'ai_estate'
  | 'governance'
  | 'performance'
  | 'usage'
  | 'genie'
  | 'lakebase'
  | 'reliability';

export interface DomainScore {
  id: DomainId;
  weight: number;
  score: number; // 0-100
  findings: number;
  criticalFindings: number;
}

export interface Finding {
  id: string;
  ruleId: string;
  domain: DomainId;
  title: string;
  severity: Severity;
  resource: string;
  frameworkControls: string[];
  selfCheck: boolean;
  status: 'open' | 'accepted_risk' | 'resolved';
}

export interface MaintenanceTask {
  id: string;
  sourceRule: string;
  resource: string;
  owner: string;
  dueAt: string; // ISO date
  recurrence: string;
  status: 'due' | 'overdue' | 'scheduled';
}

// Domain weights per spec §6.
export const DOMAIN_WEIGHTS: Record<DomainId, number> = {
  security: 25,
  finops: 20,
  ai_estate: 12,
  governance: 12,
  performance: 10,
  usage: 8,
  genie: 6,
  lakebase: 4,
  reliability: 3,
};

export const domainScores: DomainScore[] = [
  { id: 'security', weight: 25, score: 68, findings: 14, criticalFindings: 2 },
  { id: 'finops', weight: 20, score: 74, findings: 11, criticalFindings: 0 },
  { id: 'ai_estate', weight: 12, score: 61, findings: 8, criticalFindings: 1 },
  { id: 'governance', weight: 12, score: 79, findings: 9, criticalFindings: 0 },
  { id: 'performance', weight: 10, score: 83, findings: 5, criticalFindings: 0 },
  { id: 'usage', weight: 8, score: 88, findings: 3, criticalFindings: 0 },
  { id: 'genie', weight: 6, score: 71, findings: 4, criticalFindings: 0 },
  { id: 'lakebase', weight: 4, score: 65, findings: 3, criticalFindings: 0 },
  { id: 'reliability', weight: 3, score: 90, findings: 1, criticalFindings: 0 },
];

// Weighted overall score, rounded — matches compass_core/scoring.py.
export function overallScore(): number {
  const totalWeight = domainScores.reduce((s, d) => s + d.weight, 0);
  const weighted = domainScores.reduce((s, d) => s + d.score * d.weight, 0);
  return Math.round(weighted / totalWeight);
}

export const scoreDelta = 4; // points improved since last scan
export const coveragePct = 82; // % of rules evaluable given current capabilities

export const aiSpend = {
  last30dUsd: 18420,
  attributedPct: 63, // % of AI spend with user/team/use-case attribution
  wowChangePct: 12.4,
  topModel: 'databricks-claude-sonnet-4-5',
  endpointsWithoutSpendCap: 3,
};

export const complianceCoverage = [
  { framework: 'dbx-security-best-practices', met: 41, partial: 12, notMet: 9, manual: 6, total: 68 },
  { framework: 'ai-governance-baseline', met: 14, partial: 5, notMet: 6, manual: 3, total: 28 },
];

export const findings: Finding[] = [
  {
    id: 'F-1001',
    ruleId: 'SEC-027',
    domain: 'security',
    title: 'App service principal holds ALL PRIVILEGES on a catalog',
    severity: 'critical',
    resource: 'sp: compass-app / catalog: main',
    frameworkControls: ['DBX-SBP:IAM-3', 'ISO27001:A.5.15', 'SOC2:CC6.1'],
    selfCheck: true,
    status: 'open',
  },
  {
    id: 'F-1002',
    ruleId: 'AIG-003',
    domain: 'ai_estate',
    title: 'Serving endpoint without spend cap; unattributed AI spend above threshold',
    severity: 'high',
    resource: 'endpoint: prod-rag-router',
    frameworkControls: ['AIGOV:BUDGET-1', 'DBX-SBP:MON-2'],
    selfCheck: false,
    status: 'open',
  },
  {
    id: 'F-1003',
    ruleId: 'AIG-004',
    domain: 'ai_estate',
    title: 'User-facing endpoint without input/output guardrails',
    severity: 'high',
    resource: 'endpoint: support-agent',
    frameworkControls: ['AIGOV:GUARD-1'],
    selfCheck: false,
    status: 'open',
  },
  {
    id: 'F-1004',
    ruleId: 'SEC-029',
    domain: 'security',
    title: 'Workspace still allows PATs where OAuth is feasible',
    severity: 'high',
    resource: 'workspace: fevm-moi-ai',
    frameworkControls: ['DBX-SBP:IAM-5', 'CIS:1.2'],
    selfCheck: false,
    status: 'open',
  },
  {
    id: 'F-1005',
    ruleId: 'FIN-029',
    domain: 'finops',
    title: 'Lakebase project without scale-to-zero on non-production compute',
    severity: 'medium',
    resource: 'lakebase: analytics-dev',
    frameworkControls: ['DBX-SBP:MON-4'],
    selfCheck: false,
    status: 'open',
  },
  {
    id: 'F-1006',
    ruleId: 'GEN-013',
    domain: 'genie',
    title: 'Genie Agent built on tables without certified metric views',
    severity: 'medium',
    resource: 'genie: revenue-explorer',
    frameworkControls: [],
    selfCheck: false,
    status: 'open',
  },
  {
    id: 'F-1007',
    ruleId: 'LKB-001',
    domain: 'lakebase',
    title: 'Native password authentication enabled on Lakebase project',
    severity: 'high',
    resource: 'lakebase: app-state',
    frameworkControls: ['DBX-SBP:IAM-7'],
    selfCheck: true,
    status: 'open',
  },
  {
    id: 'F-1008',
    ruleId: 'GOV-025',
    domain: 'governance',
    title: 'Top-queried tables lacking descriptions (metadata debt)',
    severity: 'low',
    resource: 'catalog: main / 6 tables',
    frameworkControls: ['DBX-SBP:GOV-2'],
    selfCheck: false,
    status: 'open',
  },
];

export const maintenance: MaintenanceTask[] = [
  {
    id: 'M-2001',
    sourceRule: 'MNT-002',
    resource: 'sp: prod-etl OAuth secret',
    owner: 'platform@demo',
    dueAt: isoInDays(3),
    recurrence: 'on-expiry',
    status: 'due',
  },
  {
    id: 'M-2002',
    sourceRule: 'MNT-001',
    resource: 'job cluster: nightly-batch (DBR 13.3 EOS)',
    owner: 'data-eng@demo',
    dueAt: isoInDays(6),
    recurrence: 'quarterly',
    status: 'due',
  },
  {
    id: 'M-2003',
    sourceRule: 'MNT-004',
    resource: 'exception: SEC-018 waiver',
    owner: 'security@demo',
    dueAt: isoInDays(-2),
    recurrence: 'on-expiry',
    status: 'overdue',
  },
  {
    id: 'M-2004',
    sourceRule: 'MNT-007',
    resource: 'lakebase branch: feature/pricing (idle 21d)',
    owner: 'ml@demo',
    dueAt: isoInDays(5),
    recurrence: 'weekly',
    status: 'due',
  },
];

export const meta = {
  demoMode: true,
  lastScanAt: isoInDays(-1),
  scanId: 'demo-scan-0001',
  policyProfile: 'STANDARD',
  rulesEvaluated: 58,
  capabilities: {
    available: 21,
    notAvailable: 7,
    degraded: 3,
  },
};

function isoInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
