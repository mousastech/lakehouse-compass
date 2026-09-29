import { useMemo, useState } from 'react';
import { Lightbulb, Loader2, CheckCircle2 } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { toStr, toNum } from '../lib/rows';
import { useT } from '../lib/i18n';
import { fmtUsd } from '../lib/format';
import { TeachButton } from './TeachButton';

interface Rec {
  id: string;
  ruleId: string;
  title: string;
  resourceType: string;
  resourceName: string;
  why: string;
  how: string;
  monthlySpend: number;
  point: number;
  low: number;
  high: number;
  status: string; // bookable | estimated | advisory
  confidence: string; // high | medium | low
  effort: string;
  priority: string;
  nba: number;
}

const STATUS_STYLE: Record<string, { varName: string; key: string }> = {
  bookable: { varName: '--domain-finops', key: 'finops.rec.status.bookable' },
  estimated: { varName: '--sev-medium', key: 'finops.rec.status.estimated' },
  advisory: { varName: '--sev-low', key: 'finops.rec.status.advisory' },
};
const CONF_VAR: Record<string, string> = {
  high: '--domain-finops',
  medium: '--sev-medium',
  low: '--sev-low',
};

function Pill({ label, varName }: { label: string; varName: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color: `var(${varName})`, background: `color-mix(in oklch, var(${varName}) 15%, transparent)` }}
    >
      {label}
    </span>
  );
}

/** Dollarized, NBA-ranked FinOps recommendations. Each row carries a savings
 * band, a confidence tier and a one-click Draft change into the approval flow. */
export function RecommendationsPanel({ ws }: { ws: string }) {
  const t = useT();
  const { rows, loading } = useLiveRows('finops_recommendations', '/api/rows/finops_recommendations', ws);
  const [drafted, setDrafted] = useState<Record<string, string>>({});
  const [drafting, setDrafting] = useState('');

  const recs = useMemo<Rec[]>(
    () =>
      rows.map((r) => ({
        id: toStr(r.recommendation_id),
        ruleId: toStr(r.rule_id),
        title: toStr(r.rule_title),
        resourceType: toStr(r.resource_type),
        resourceName: toStr(r.resource_name) || '—',
        why: toStr(r.why),
        how: toStr(r.how),
        monthlySpend: toNum(r.monthly_spend_usd),
        point: toNum(r.savings_point_usd),
        low: toNum(r.savings_low_usd),
        high: toNum(r.savings_high_usd),
        status: toStr(r.savings_status) || 'advisory',
        confidence: toStr(r.confidence) || 'low',
        effort: toStr(r.effort_band) || 'medium',
        priority: toStr(r.priority) || 'LOW',
        nba: toNum(r.nba_score),
      })),
    [rows],
  );

  // Booked headline: only the conservative `low` of bookable findings.
  const bookedMonthly = useMemo(
    () => recs.filter((r) => r.status === 'bookable').reduce((s, r) => s + r.low, 0),
    [recs],
  );

  const draft = async (id: string) => {
    setDrafting(id);
    try {
      const res = await fetch('/api/agent/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finding_id: id, ws }),
      });
      const j = (await res.json()) as { change_id?: string; error?: string };
      setDrafted((d) => ({ ...d, [id]: j.change_id || (j.error ? 'error' : 'done') }));
    } catch {
      setDrafted((d) => ({ ...d, [id]: 'error' }));
    } finally {
      setDrafting('');
    }
  };

  const savingsLabel = (r: Rec) => {
    if (r.status === 'advisory') return t('finops.rec.noBooking');
    if (r.low === r.high) return `${fmtUsd(r.point)}/mo`;
    return `${fmtUsd(r.low)} – ${fmtUsd(r.high)}/mo`;
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4" style={{ color: 'var(--domain-finops)' }} />
          <h2 className="text-sm font-semibold text-card-foreground">{t('finops.rec.title')}</h2>
        </div>
        {recs.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('finops.rec.bookedMonthly')}: <strong style={{ color: 'var(--domain-finops)' }}>{fmtUsd(bookedMonthly)}/mo</strong>
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t('finops.rec.subtitle')}</p>

      {loading ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      ) : recs.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">{t('finops.rec.none')}</p>
      ) : (
        <ul className="space-y-3">
          {recs.map((r) => {
            const st = STATUS_STYLE[r.status] || STATUS_STYLE.advisory;
            const done = drafted[r.id];
            return (
              <li key={r.id} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{r.title}</span>
                      <span className="text-xs text-muted-foreground">· {r.resourceType} <code className="rounded bg-muted px-1">{r.resourceName}</code></span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Pill label={`${t('finops.rec.save')} ${savingsLabel(r)}`} varName="--domain-finops" />
                      <Pill label={t(st.key)} varName={st.varName} />
                      <Pill label={`${t('finops.rec.confidence')}: ${t('finops.rec.conf.' + r.confidence)}`} varName={CONF_VAR[r.confidence] || '--sev-low'} />
                      <Pill label={`${t('finops.rec.effort')}: ${t('finops.rec.effortBand.' + r.effort)}`} varName="--muted-foreground" />
                      <Pill label={r.priority} varName={r.priority === 'HIGH' ? '--sev-high' : r.priority === 'MEDIUM' ? '--sev-medium' : '--sev-low'} />
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{r.why}</p>
                <p className="mt-1 text-xs text-foreground"><strong>{t('finops.rec.how')}:</strong> {r.how}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {done ? (
                    <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--domain-finops)' }}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {done === 'error' ? t('finops.rec.draftError') : t('finops.rec.drafted')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => draft(r.id)}
                      disabled={drafting === r.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
                    >
                      {drafting === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {t('finops.rec.draftChange')}
                    </button>
                  )}
                  <TeachButton ctx={{ domain: 'finops', ruleId: r.ruleId, title: r.title, remediation: r.how, resource: r.resourceName }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
