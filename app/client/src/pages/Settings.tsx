import { useState } from 'react';
import { Settings as SettingsIcon, Save } from 'lucide-react';
import { useT } from '../lib/i18n';
import {
  loadSettings,
  saveSettings,
  type Settings as S,
  type PolicyProfile,
  type Density,
} from '../lib/settings';

const PROFILES: PolicyProfile[] = ['STRICT', 'STANDARD', 'DEVELOPMENT'];
const FRAMEWORKS = ['dbx-security-best-practices', 'ai-governance-baseline'];

export function Settings() {
  const t = useT();
  const [s, setS] = useState<S>(() => loadSettings());
  const [saved, setSaved] = useState(false);

  const upd = <K extends keyof S>(k: K, v: S[K]) => {
    setS((prev) => ({ ...prev, [k]: v }));
    setSaved(false);
  };
  const save = () => {
    saveSettings(s);
    setSaved(true);
  };
  const toggleFw = (fw: string) =>
    upd('enabledFrameworks', s.enabledFrameworks.includes(fw) ? s.enabledFrameworks.filter((f) => f !== fw) : [...s.enabledFrameworks, fw]);

  const num = (id: string, label: string, k: keyof S) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        id={id}
        name={id}
        type="number"
        value={s[k] as number}
        onChange={(e) => upd(k, Number(e.target.value) as S[keyof S])}
        className="w-24 rounded-md border border-border bg-card px-2 py-1 text-right text-foreground"
      />
    </label>
  );

  return (
    <div className="mx-auto max-w-[900px] space-y-5">
      <div className="flex items-center gap-2">
        <SettingsIcon className="h-5 w-5" style={{ color: 'var(--primary)' }} />
        <h1 className="text-xl font-semibold text-foreground">{t('nav.settings')}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{t('settings.note')}</p>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('settings.policyProfile')}</h2>
        <div className="flex gap-2">
          {PROFILES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => upd('policyProfile', p)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${s.policyProfile === p ? 'border-[var(--primary)] text-foreground' : 'border-border text-muted-foreground hover:bg-accent'}`}
            >
              {p}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold text-card-foreground">{t('settings.config')}</h2>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{t('settings.approvedProviders')}</span>
          <input id="approved_providers" name="approved_providers" value={s.approvedProviders}
            onChange={(e) => upd('approvedProviders', e.target.value)}
            className="w-64 rounded-md border border-border bg-card px-2 py-1 text-foreground" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{t('settings.requireGuardrails')}</span>
          <input id="require_guardrails" name="require_guardrails" type="checkbox" checked={s.requireGuardrailsOnUserFacing}
            onChange={(e) => upd('requireGuardrailsOnUserFacing', e.target.checked)} className="h-4 w-4" />
        </label>
        {num('max_days_without_eval', t('settings.maxDaysEval'), 'maxDaysWithoutEval')}
        {num('lakebase_branch_age', t('settings.lakebaseBranchAge'), 'lakebaseDevBranchMaxAgeDays')}
        {num('lakebase_snapshot_pct', t('settings.lakebaseSnapshotPct'), 'lakebaseSnapshotGrowthAlertPct')}
        {num('runtime_eol_lead', t('settings.runtimeEol'), 'runtimeEolLeadDays')}
        {num('credential_expiry_lead', t('settings.credExpiry'), 'credentialExpiryLeadDays')}
        <div>
          <div className="mb-1.5 text-sm text-muted-foreground">{t('settings.frameworks')}</div>
          <div className="flex flex-wrap gap-2">
            {FRAMEWORKS.map((fw) => (
              <label key={fw} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-foreground">
                <input id={`fw_${fw}`} name={`fw_${fw}`} type="checkbox" checked={s.enabledFrameworks.includes(fw)} onChange={() => toggleFw(fw)} />
                {fw}
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('settings.density')}</h2>
        <div className="flex gap-2">
          {(['comfortable', 'compact'] as Density[]).map((d) => (
            <button key={d} type="button" onClick={() => upd('density', d)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium capitalize ${s.density === d ? 'border-[var(--primary)] text-foreground' : 'border-border text-muted-foreground hover:bg-accent'}`}>
              {t(`settings.${d}`)}
            </button>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}>
          <Save className="h-4 w-4" /> {t('settings.save')}
        </button>
        {saved && <span className="text-sm" style={{ color: 'var(--domain-finops)' }}>{t('settings.saved')}</span>}
      </div>
      <p className="text-xs text-muted-foreground">{t('settings.persistNote')}</p>
    </div>
  );
}
