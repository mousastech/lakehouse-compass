import { useMemo } from 'react';
import { Users, Sparkles, CircleSlash } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { toNum, toStr } from '../lib/rows';
import { useT } from '../lib/i18n';
import { KpiCard } from '../components/KpiCard';
import { SourceBadge } from '../components/SourceBadge';
import { Heatmap, type HeatCell } from '../components/Heatmap';
import { SeriesChart } from '../components/SeriesChart';
import { FindingsList } from '../components/FindingsList';

export function Usage() {
  const t = useT();
  const { ws } = useWorkspace();
  const summary = useLiveRows('usage_summary', '/api/rows/usage_summary', ws);
  const heat = useLiveRows('usage_heatmap', '/api/rows/usage_heatmap', ws);
  const trend = useLiveRows('usage_active_users_trend', '/api/rows/usage_active_users_trend', ws);

  const m = useMemo(() => {
    const o: Record<string, number> = {};
    for (const r of summary.rows) o[toStr(r.metric)] = toNum(r.value);
    return o;
  }, [summary.rows]);
  const cells: HeatCell[] = useMemo(() => heat.rows.map((r) => ({ dow: toNum(r.dow), hour: toNum(r.hour), n: toNum(r.n) })), [heat.rows]);
  const trendSorted = useMemo(() => [...trend.rows].sort((a, b) => toStr(a.period_start).localeCompare(toStr(b.period_start))), [trend.rows]);
  const labels = trendSorted.map((r) => toStr(r.period_start));
  const activeSeries = trendSorted.map((r) => toNum(r.active_users));
  const genieSeries = trendSorted.map((r) => toNum(r.genie_users));

  const genieCodeAvailable = m['genie_code_available'] === 1;

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t('nav.usage')}</h1>
        <SourceBadge source={summary.source} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
        <KpiCard label="DAU" value={m['dau'] ?? 0} accentVar="--domain-usage" icon={<Users className="h-4 w-4" />} />
        <KpiCard label="WAU" value={m['wau'] ?? 0} accentVar="--domain-usage" />
        <KpiCard label="MAU" value={m['mau'] ?? 0} accentVar="--domain-usage" />
        <KpiCard label={t('usage.activeUsers')} value={m['active_users_30d'] ?? 0} accentVar="--domain-performance" />
        <KpiCard label={t('usage.concentration')} value={`${m['top_identity_share_pct'] ?? 0}%`} accentVar="--sev-medium" />
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('usage.activeTrend')}</h2>
        <SeriesChart
          labels={labels}
          series={[
            { label: t('usage.activeUsersShort'), values: activeSeries, colorVar: '--domain-performance' },
            { label: t('usage.genieUsers'), values: genieSeries, colorVar: '--domain-genie', dashed: true },
          ]}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-card-foreground">
            <Sparkles className="h-4 w-4" style={{ color: 'var(--domain-genie)' }} /> {t('usage.genieAdoption')}
          </h2>
          <div className="flex items-center gap-6">
            <div>
              <div className="tnum text-3xl font-semibold" style={{ color: 'var(--domain-genie)' }}>{m['genie_adoption_pct'] ?? 0}%</div>
              <div className="text-xs text-muted-foreground">{t('usage.genieAdoptionNote')}</div>
            </div>
            <div className="text-sm text-muted-foreground">
              <div>{t('usage.genieUsers')}: <span className="tnum text-foreground">{m['genie_users'] ?? 0}</span> / MAU {m['mau'] ?? 0}</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('usage.genieSplit')}</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between rounded-lg border border-border/60 p-2.5">
              <span>{t('usage.genieAgents')}</span>
              <span className="tnum text-muted-foreground">{m['genie_statements'] ?? 0} {t('usage.statements')} · {m['genie_users'] ?? 0} {t('usage.usersShort')}</span>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-border/60 p-2.5">
              <span className="flex items-center gap-1.5">{t('usage.genieCode')}</span>
              {genieCodeAvailable ? (
                <span className="tnum text-muted-foreground">{m['genie_code_statements'] ?? 0} {t('usage.statements')}</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--sev-medium)' }}>
                  <CircleSlash className="h-3.5 w-3.5" /> NOT AVAILABLE
                </span>
              )}
            </li>
          </ul>
          {!genieCodeAvailable && <p className="mt-2 text-[11px] text-muted-foreground">{t('usage.genieCodeNa')}</p>}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('usage.heatmap')}</h2>
        <Heatmap cells={cells} />
      </section>

      <FindingsList domain="usage" />
    </div>
  );
}
