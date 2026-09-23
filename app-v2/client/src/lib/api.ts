import { useEffect, useState } from 'react';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type DomainId =
  | 'security'
  | 'finops'
  | 'ai_estate'
  | 'governance'
  | 'performance'
  | 'usage'
  | 'genie'
  | 'genie_readiness'
  | 'lakebase'
  | 'reliability';

export interface DomainScore {
  id: DomainId;
  weight: number;
  score: number;
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
  status: string;
}

export interface MaintenanceTask {
  id: string;
  sourceRule: string;
  resource: string;
  owner: string;
  dueAt: string;
  recurrence: string;
  status: 'due' | 'overdue' | 'scheduled';
}

export interface OverviewData {
  score: number;
  scoreDelta: number;
  coveragePct: number;
  domains: DomainScore[];
  aiSpend: {
    last30dUsd: number;
    attributedPct: number;
    wowChangePct: number;
    topModel: string;
    endpointsWithoutSpendCap: number;
  };
  complianceCoverage: {
    framework: string;
    met: number;
    partial: number;
    notMet: number;
    manual: number;
    total: number;
  }[];
  maintenanceDueThisWeek: MaintenanceTask[];
  topFindings: Finding[];
  meta: {
    demoMode: boolean;
    lastScanAt: string;
    scanId: string;
    policyProfile: string;
    rulesEvaluated: number;
  };
}

/**
 * Fetches JSON from an API route. Returns a client-side fallback if the request
 * fails, so the UI always renders a designed state (spec §20.4).
 */
export function useApi<T>(path: string, fallback: T): { data: T; loading: boolean } {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(path)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => {
        if (alive) setData(json as T);
      })
      .catch(() => {
        /* keep fallback */
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path]);

  return { data, loading };
}
