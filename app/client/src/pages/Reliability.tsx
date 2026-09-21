import { useMemo } from 'react';
import { Activity } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { firstRow, toNum } from '../lib/rows';
import { useT } from '../lib/i18n';
import { KpiCard } from '../components/KpiCard';
import { SourceBadge } from '../components/SourceBadge';
import { FindingsList } from '../components/FindingsList';

export function Reliability() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows, source } = useLiveRows('reliability_summary', '/api/rows/reliability_summary', ws);
  const s = useMemo(() => firstRow(rows), [rows]);
  const total = toNum(s.total_runs);
  const errors = toNum(s.errors);
  const succeeded = toNum(s.succeeded);
  const failure = toNum(s.failure_rate_pct);
  const failColor = failure >= 40 ? '--sev-critical' : failure >= 20 ? '--sev-high' : '--domain-finops';

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t('nav.reliability')}</h1>
        <SourceBadge source={source} />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label={t('rel.failureRate')} value={`${failure}%`} accentVar={failColor} icon={<Activity className="h-4 w-4" />} />
        <KpiCard label={t('rel.totalRuns')} value={total} accentVar="--domain-reliability" />
        <KpiCard label={t('rel.errors')} value={errors} accentVar="--sev-high" />
        <KpiCard label={t('rel.succeeded')} value={succeeded} accentVar="--domain-finops" />
      </div>
      {total > 0 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('rel.runOutcomes')}</h2>
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
            <div style={{ width: `${(100 * succeeded) / total}%`, background: 'var(--domain-finops)' }} />
            <div style={{ width: `${(100 * errors) / total}%`, background: 'var(--sev-critical)' }} />
          </div>
          <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
            <span><span className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--domain-finops)' }} /> {t('rel.succeeded')} {succeeded}</span>
            <span><span className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--sev-critical)' }} /> {t('rel.errors')} {errors}</span>
          </div>
        </section>
      )}
      <FindingsList domain="reliability" />
    </div>
  );
}
