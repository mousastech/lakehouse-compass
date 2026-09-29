import { useMemo } from 'react';
import { LayoutGrid, Wifi, WifiOff } from 'lucide-react';
import { NavLink } from 'react-router';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { toStr, toNum } from '../lib/rows';
import { useT } from '../lib/i18n';
import { KpiCard } from '../components/KpiCard';

interface Space {
  title: string;
  owner: string;
  hasDescription: boolean;
  msgs: number;
  setupScore: number;
  status: string;
}

const STATUS_VAR: Record<string, string> = {
  Active: '--domain-finops',
  'Low use': '--sev-medium',
  Unused: '--sev-high',
};

/** Genie Portfolio Overview — fleet-level health of every Genie space: how much
 * is actively leveraged vs stalling, and what needs attention. */
export function GeniePortfolio() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows, loading, source } = useLiveRows('genie_space_inventory', '/api/rows/genie_space_inventory', ws);

  const spaces = useMemo<Space[]>(
    () =>
      rows.map((r) => ({
        title: toStr(r.title) || toStr(r.space_id),
        owner: toStr(r.owner),
        hasDescription: !!r.has_description,
        msgs: toNum(r.msgs_30d),
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
    const noDesc = spaces.filter((s) => !s.hasDescription).length;
    const msgs = spaces.reduce((a, s) => a + s.msgs, 0);
    const avgSetup = total ? Math.round(spaces.reduce((a, s) => a + s.setupScore, 0) / total) : 0;
    const leverage = total ? Math.round((100 * active) / total) : 0;
    const attention = spaces.filter((s) => s.status === 'Unused' || !s.owner || !s.hasDescription).length;
    const top = [...spaces].sort((a, b) => b.msgs - a.msgs).slice(0, 8);
    const maxMsgs = top.length ? Math.max(...top.map((s) => s.msgs), 1) : 1;
    return { total, active, low, unused, noOwner, noDesc, msgs, avgSetup, leverage, attention, top, maxMsgs };
  }, [spaces]);

  const seg = (n: number) => (m.total ? `${(100 * n) / m.total}%` : '0%');

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

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('genieportfolio.leverageBreakdown')}</h2>
            <div className="flex h-4 w-full overflow-hidden rounded-full">
              <div style={{ width: seg(m.active), background: 'var(--domain-finops)' }} title={`Active ${m.active}`} />
              <div style={{ width: seg(m.low), background: 'var(--sev-medium)' }} title={`Low use ${m.low}`} />
              <div style={{ width: seg(m.unused), background: 'var(--sev-high)' }} title={`Unused ${m.unused}`} />
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span><span style={{ color: 'var(--domain-finops)' }}>●</span> {t('geniespaces.status.Active')} {m.active}</span>
              <span><span style={{ color: 'var(--sev-medium)' }}>●</span> {t('geniespaces.status.Lowuse')} {m.low}</span>
              <span><span style={{ color: 'var(--sev-high)' }}>●</span> {t('geniespaces.status.Unused')} {m.unused}</span>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('genieportfolio.topSpaces')}</h2>
            <ul className="space-y-2">
              {m.top.map((s) => (
                <li key={s.title} className="flex items-center gap-3">
                  <span className="w-1/3 truncate text-sm text-foreground" title={s.title}>{s.title}</span>
                  <div className="flex-1">
                    <div className="h-3 rounded-full" style={{ width: `${(100 * s.msgs) / m.maxMsgs}%`, background: `var(${STATUS_VAR[s.status] || '--primary'})`, minWidth: s.msgs > 0 ? '2%' : '0' }} />
                  </div>
                  <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">{s.msgs} {t('genieportfolio.msgsShort')}</span>
                </li>
              ))}
            </ul>
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
