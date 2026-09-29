import { useMemo, useState } from 'react';
import { LayoutGrid, Wifi, WifiOff } from 'lucide-react';
import { NavLink } from 'react-router';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { toStr, toNum } from '../lib/rows';
import { useT } from '../lib/i18n';
import { KpiCard } from '../components/KpiCard';
import { BarChart, type Bar } from '../components/BarChart';
import { SeriesChart } from '../components/SeriesChart';

interface Space {
  title: string;
  owner: string;
  hasDescription: boolean;
  msgs: number;
  users: number;
  setupScore: number;
  status: string;
}

/** Genie Portfolio Overview — fleet health of every Genie space, with the same
 * charts as the reference governance console: activity by top space, leverage
 * breakdown, and the weekly adoption trend. */
export function GeniePortfolio() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows, loading, source } = useLiveRows('genie_space_inventory', '/api/rows/genie_space_inventory', ws);
  const trend = useLiveRows('usage_active_users_trend', '/api/rows/usage_active_users_trend', ws);
  const [metric, setMetric] = useState<'msgs' | 'users'>('msgs');

  const spaces = useMemo<Space[]>(
    () =>
      rows.map((r) => ({
        title: toStr(r.title) || toStr(r.space_id),
        owner: toStr(r.owner),
        hasDescription: !!r.has_description,
        msgs: toNum(r.msgs_30d),
        users: toNum(r.users_30d),
        setupScore: toNum(r.setup_score),
        status: toStr(r.usage_status) || 'Unused',
      })),
    [rows],
  );

  const m = useMemo(() => {
    const total = spaces.length;
    const active = spaces.filter((s) => s.status === 'Active').length;
    const low = spaces.filter((s) => s.status === 'Low use').length;
    const unused = spaces.filter((s) => s.status === 'Unused').length;
    const noOwner = spaces.filter((s) => !s.owner).length;
    const msgs = spaces.reduce((a, s) => a + s.msgs, 0);
    const avgSetup = total ? Math.round(spaces.reduce((a, s) => a + s.setupScore, 0) / total) : 0;
    const leverage = total ? Math.round((100 * active) / total) : 0;
    const attention = spaces.filter((s) => s.status === 'Unused' || !s.owner || !s.hasDescription).length;
    return { total, active, low, unused, noOwner, msgs, avgSetup, leverage, attention };
  }, [spaces]);

  const activityBars = useMemo<Bar[]>(() => {
    const key = metric === 'msgs' ? 'msgs' : 'users';
    return [...spaces].sort((a, b) => b[key] - a[key]).slice(0, 10).map((s) => ({ label: s.title, value: s[key], color: '--primary' }));
  }, [spaces, metric]);

  const leverageBars = useMemo<Bar[]>(
    () => [
      { label: t('geniespaces.status.Active'), value: m.active, color: '--domain-finops' },
      { label: t('geniespaces.status.Lowuse'), value: m.low, color: '--sev-medium' },
      { label: t('geniespaces.status.Unused'), value: m.unused, color: '--sev-high' },
    ],
    [m, t],
  );

  const trendData = useMemo(() => {
    const sorted = [...trend.rows].sort((a, b) => toStr(a.period_start).localeCompare(toStr(b.period_start)));
    return {
      labels: sorted.map((r) => toStr(r.period_start)),
      genie: sorted.map((r) => toNum(r.genie_users)),
    };
  }, [trend.rows]);

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5" style={{ color: 'var(--primary)' }} />
          <h1 className="text-xl font-semibold text-foreground">{t('genieportfolio.title')}</h1>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{ color: source === 'live' ? 'var(--domain-finops)' : 'var(--sev-medium)',
            background: `color-mix(in oklch, var(${source === 'live' ? '--domain-finops' : '--sev-medium'}) 16%, transparent)` }}>
          {source === 'live' ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {source === 'live' ? t('meta.live') : t('meta.demoMode')}
        </span>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{t('genieportfolio.subtitle')}</p>

      {loading ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : m.total === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">{t('geniespaces.none')}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard label={t('geniespaces.total')} value={String(m.total)} accentVar="--primary" />
            <KpiCard label={t('genieportfolio.leverage')} value={`${m.leverage}%`} sub={`${m.active} active`} accentVar="--domain-finops" />
            <KpiCard label={t('geniespaces.unused')} value={String(m.unused)} accentVar="--sev-high" />
            <KpiCard label={t('geniespaces.noOwner')} value={String(m.noOwner)} accentVar="--sev-medium" />
            <KpiCard label={t('genieportfolio.msgs')} value={m.msgs.toLocaleString()} accentVar="--primary" />
            <KpiCard label={t('genieportfolio.avgSetup')} value={`${m.avgSetup}%`} accentVar="--domain-genie" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-card-foreground">{t('genieportfolio.activity')}</h2>
                <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
                  <button type="button" onClick={() => setMetric('msgs')}
                    className={`px-2.5 py-1 font-medium ${metric === 'msgs' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
                    {t('genieportfolio.messages')}
                  </button>
                  <button type="button" onClick={() => setMetric('users')}
                    className={`px-2.5 py-1 font-medium ${metric === 'users' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
                    {t('genieportfolio.users')}
                  </button>
                </div>
              </div>
              <BarChart bars={activityBars} height={260}
                yLabel={metric === 'msgs' ? t('genieportfolio.messages') : t('genieportfolio.users')} />
            </section>

            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('genieportfolio.leverageBreakdown')}</h2>
              <BarChart bars={leverageBars} height={260} yLabel={t('genieportfolio.spaces')} rotateLabels={false} />
            </section>
          </div>

          <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-card-foreground">{t('genieportfolio.adoption')}</h2>
              <span className="text-xs text-muted-foreground">{t('genieportfolio.adoptionHint')}</span>
            </div>
            {trendData.labels.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">—</p>
            ) : (
              <SeriesChart
                labels={trendData.labels}
                series={[{ label: t('genieportfolio.adoptionSeries'), values: trendData.genie, colorVar: '--domain-finops' }]}
                height={240}
              />
            )}
          </section>

          <NavLink to="/genie-optimize" className="flex items-center justify-between rounded-xl border border-border bg-card p-4 hover:bg-muted">
            <div>
              <div className="text-sm font-semibold text-card-foreground">{t('genieportfolio.attention')}</div>
              <div className="text-xs text-muted-foreground">{t('genieportfolio.attentionHint')}</div>
            </div>
            <span className="rounded-full px-3 py-1 text-lg font-semibold" style={{ color: 'var(--sev-high)', background: 'color-mix(in oklch, var(--sev-high) 15%, transparent)' }}>{m.attention}</span>
          </NavLink>
        </>
      )}
    </div>
  );
}
