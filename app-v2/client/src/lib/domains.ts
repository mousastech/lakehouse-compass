import type { DomainId, Severity } from './api';

export const DOMAIN_META: Record<DomainId, { tKey: string; colorVar: string }> = {
  security: { tKey: 'nav.security', colorVar: '--domain-security' },
  finops: { tKey: 'nav.finops', colorVar: '--domain-finops' },
  ai_estate: { tKey: 'nav.ai_estate', colorVar: '--domain-ai_estate' },
  governance: { tKey: 'nav.governance', colorVar: '--domain-governance' },
  performance: { tKey: 'nav.performance', colorVar: '--domain-performance' },
  usage: { tKey: 'nav.usage', colorVar: '--domain-usage' },
  genie: { tKey: 'nav.genie', colorVar: '--domain-genie' },
  genie_readiness: { tKey: 'nav.genie_readiness', colorVar: '--domain-genie' },
  lakebase: { tKey: 'nav.lakebase', colorVar: '--domain-lakebase' },
  reliability: { tKey: 'nav.reliability', colorVar: '--domain-reliability' },
};

export const DOMAIN_PATH: Record<DomainId, string> = {
  security: '/security',
  finops: '/finops',
  ai_estate: '/ai-estate',
  governance: '/governance',
  performance: '/performance',
  usage: '/usage',
  genie: '/genie',
  genie_readiness: '/genie-readiness',
  lakebase: '/lakebase',
  reliability: '/reliability',
};

export const SEVERITY_VAR: Record<Severity, string> = {
  critical: '--sev-critical',
  high: '--sev-high',
  medium: '--sev-medium',
  low: '--sev-low',
  info: '--sev-info',
};

export function scoreColorVar(score: number): string {
  if (score >= 85) return '--domain-finops'; // green-ish
  if (score >= 70) return '--sev-medium'; // amber
  if (score >= 55) return '--sev-high'; // orange
  return '--sev-critical'; // red
}
