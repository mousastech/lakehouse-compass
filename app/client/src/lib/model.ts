import { toNum, toStr, toBool, toArr } from './rows';
import type { DomainId, Severity } from './api';

export interface FindingRow {
  id: string;
  ruleId: string;
  domain: DomainId;
  title: string;
  severity: Severity;
  resource: string;
  status: string;
  frameworkControls: string[];
  evidence: Record<string, unknown>;
  remediation: string;
  selfCheck: boolean;
}

export interface ScoreRow {
  domain: string;
  weight: number;
  score: number;
  findings: number;
  criticalFindings: number;
  isOverall: boolean;
  coveragePct: number;
}

export interface CostRow {
  product: string;
  sku: string;
  identity: string;
  costUsd: number;
  dbus: number;
  isAi: boolean;
}

export interface ComplianceRow {
  framework: string;
  controlId: string;
  title: string;
  category: string;
  status: string;
}

const SEVS: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export function normFinding(r: Record<string, unknown>): FindingRow {
  let evidence: Record<string, unknown> = {};
  const ev = r.evidence_json;
  if (typeof ev === 'string' && ev.trim()) {
    try {
      evidence = JSON.parse(ev);
    } catch {
      evidence = {};
    }
  } else if (ev && typeof ev === 'object') {
    evidence = ev as Record<string, unknown>;
  }
  const sev = toStr(r.severity).toLowerCase();
  return {
    id: toStr(r.finding_id || r.id),
    ruleId: toStr(r.rule_id),
    domain: toStr(r.domain) as DomainId,
    title: toStr(r.title),
    severity: (SEVS.includes(sev as Severity) ? sev : 'info') as Severity,
    resource: toStr(r.resource),
    status: toStr(r.status) || 'open',
    frameworkControls: toArr(r.framework_controls),
    evidence,
    remediation: toStr(r.remediation),
    selfCheck: toBool(r.self_check),
  };
}

export function normScore(r: Record<string, unknown>): ScoreRow {
  return {
    domain: toStr(r.domain),
    weight: toNum(r.weight),
    score: toNum(r.score),
    findings: toNum(r.findings),
    criticalFindings: toNum(r.critical_findings),
    isOverall: toBool(r.is_overall),
    coveragePct: toNum(r.coverage_pct),
  };
}

export function normCost(r: Record<string, unknown>): CostRow {
  return {
    product: toStr(r.product) || '(unknown)',
    sku: toStr(r.sku),
    identity: toStr(r.identity) || '(unattributed)',
    costUsd: toNum(r.cost_usd),
    dbus: toNum(r.dbus),
    isAi: toBool(r.is_ai),
  };
}

export function normCompliance(r: Record<string, unknown>): ComplianceRow {
  return {
    framework: toStr(r.framework),
    controlId: toStr(r.control_id),
    title: toStr(r.title),
    category: toStr(r.category),
    status: toStr(r.status),
  };
}
