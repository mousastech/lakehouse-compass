// Compass settings (spec §13). Persisted in localStorage for this phase
// (per-browser); a Lakebase-backed shared store is a later phase.
export type PolicyProfile = 'STRICT' | 'STANDARD' | 'DEVELOPMENT';
export type Density = 'comfortable' | 'compact';

export interface Settings {
  policyProfile: PolicyProfile;
  approvedProviders: string; // comma-separated
  requireGuardrailsOnUserFacing: boolean;
  maxDaysWithoutEval: number;
  lakebaseDevBranchMaxAgeDays: number;
  lakebaseSnapshotGrowthAlertPct: number;
  enabledFrameworks: string[];
  runtimeEolLeadDays: number;
  credentialExpiryLeadDays: number;
  density: Density;
}

const KEY = 'compass_settings';

export const DEFAULT_SETTINGS: Settings = {
  policyProfile: 'STANDARD',
  approvedProviders: 'databricks, openai, anthropic',
  requireGuardrailsOnUserFacing: true,
  maxDaysWithoutEval: 30,
  lakebaseDevBranchMaxAgeDays: 14,
  lakebaseSnapshotGrowthAlertPct: 30,
  enabledFrameworks: ['dbx-security-best-practices', 'ai-governance-baseline'],
  runtimeEolLeadDays: 90,
  credentialExpiryLeadDays: 30,
  density: 'comfortable',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  applyDensity(s.density);
}

export function applyDensity(d: Density): void {
  try {
    document.documentElement.setAttribute('data-density', d);
  } catch {
    /* ignore */
  }
}
