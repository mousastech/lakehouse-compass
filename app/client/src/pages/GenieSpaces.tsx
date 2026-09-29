import { useMemo, useState } from 'react';
import { Boxes, Wifi, WifiOff, Search } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { toStr, toNum } from '../lib/rows';
import { useT } from '../lib/i18n';
import { fmtUsd } from '../lib/format';
import { KpiCard } from '../components/KpiCard';

interface Space {
  spaceId: string;
  title: string;
  owner: string;
  hasDescription: boolean;
  tables: number;
  msgs: number;
  users: number;
  trendPct: number;
  cost: number;
  setupScore: number;
  status: string; // Active | Low use | Unused
}

type SavedView = 'all' | 'unused' | 'noOwner' | 'costliest';

const STATUS_VAR: Record<string, string> = {
  Active: '--domain-finops',
  'Low use': '--sev-medium',
  Unused: '--sev-high',
};

function StatusPill({ status, label }: { status: string; label: string }) {
  const v = STATUS_VAR[status] || '--muted-foreground';
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color: `var(${v})`, background: `color-mix(in oklch, var(${v}) 15%, transparent)` }}>
      {label}
    </span>
  );
}

/** Genie Space Inventory — every space, who owns it, how it is used, and whether
 * it is ready to trust. Filter, sort by column, spot unused / unowned spaces. */
export function GenieSpaces() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows, loading, source } = useLiveRows('genie_space_inventory', '/api/rows/genie_space_inventory', ws);
  const [q, setQ] = useState('');
  const [view, setView] = useState<SavedView>('all');
  const [sortKey, setSortKey] = useState<'msgs' | 'cost' | 'setupScore'>('msgs');

  const spaces = useMemo<Space[]>(
    () =>
      rows.map((r) => ({
        spaceId: toStr(r.space_id),
        title: toStr(r.title) || toStr(r.space_id),
        owner: toStr(r.owner),
        hasDescription: !!r.has_description,
        tables: toNum(r.tables),
        msgs: toNum(r.msgs_30d),
        users: toNum(r.users_30d),
        trendPct: toNum(r.trend_pct),
        cost: toNum(r.cost_usd_30d),
        setupScore: toNum(r.setup_score),
        status: toStr(r.usage_status) || 'Unused',
      })),
    [rows],
  );

  const kpis = useMemo(() => {
    const total = spaces.length;
    const active = spaces.filter((s) => s.status === 'Active').length;
    const unused = spaces.filter((s) => s.status === 'Unused').length;
    const noOwner = spaces.filter((s) => !s.owner).length;
    return { total, active, unused, noOwner };
  }, [spaces]);

  const shown = useMemo(() => {
    let list = spaces;
    if (view === 'unused') list = list.filter((s) => s.status === 'Unused');
    else if (view === 'noOwner') list = list.filter((s) => !s.owner);
    else if (view === 'costliest') list = [...list].filter((s) => s.cost > 0);
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter((s) => s.title.toLowerCase().includes(needle) || s.owner.toLowerCase().includes(needle));
    }
    return [...list].sort((a, b) => b[sortKey] - a[sortKey]);
  }, [spaces, view, q, sortKey]);

  const SavedViewBtn = ({ id, label }: { id: SavedView; label: string }) => (
    <button
      type="button"
      onClick={() => setView(id)}
      className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
        view === id ? 'border-transparent bg-muted text-foreground' : 'border-border text-muted-foreground hover:bg-muted'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Boxes className="h-5 w-5" style={{ color: 'var(--domain-genie, var(--primary))' }} />
          <h1 className="text-xl font-semibold text-foreground">{t('nav.genie_spaces')}</h1>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{ color: source === 'live' ? 'var(--domain-finops)' : 'var(--sev-medium)',
            background: `color-mix(in oklch, var(${source === 'live' ? '--domain-finops' : '--sev-medium'}) 16%, transparent)` }}>
          {source === 'live' ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {source === 'live' ? t('meta.live') : t('meta.demoMode')}
        </span>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{t('geniespaces.subtitle')}</p>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label={t('geniespaces.total')} value={String(kpis.total)} accentVar="--primary" />
        <KpiCard label={t('geniespaces.active')} value={String(kpis.active)} accentVar="--domain-finops" />
        <KpiCard label={t('geniespaces.unused')} value={String(kpis.unused)} accentVar="--sev-high" />
        <KpiCard label={t('geniespaces.noOwner')} value={String(kpis.noOwner)} accentVar="--sev-medium" />
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('geniespaces.search')}
              className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-sm"
            />
          </div>
          <span className="text-xs text-muted-foreground">{t('geniespaces.savedViews')}:</span>
          <SavedViewBtn id="all" label={t('geniespaces.view.all')} />
          <SavedViewBtn id="unused" label={t('geniespaces.view.unused')} />
          <SavedViewBtn id="noOwner" label={t('geniespaces.view.noOwner')} />
          <SavedViewBtn id="costliest" label={t('geniespaces.view.costliest')} />
        </div>

        {loading ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        ) : shown.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t('geniespaces.none')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">{t('geniespaces.col.space')}</th>
                  <th className="py-2 pr-3">{t('geniespaces.col.owner')}</th>
                  <th className="cursor-pointer py-2 pr-3" onClick={() => setSortKey('msgs')}>{t('geniespaces.col.msgs')}</th>
                  <th className="py-2 pr-3">{t('geniespaces.col.users')}</th>
                  <th className="py-2 pr-3">{t('geniespaces.col.trend')}</th>
                  <th className="cursor-pointer py-2 pr-3" onClick={() => setSortKey('cost')}>{t('geniespaces.col.cost')}</th>
                  <th className="cursor-pointer py-2 pr-3" onClick={() => setSortKey('setupScore')}>{t('geniespaces.col.setup')}</th>
                  <th className="py-2 pr-3">{t('geniespaces.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.spaceId} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-medium text-foreground">{s.title}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{s.owner || '—'}</td>
                    <td className="py-2 pr-3">{s.msgs}</td>
                    <td className="py-2 pr-3">{s.users}</td>
                    <td className="py-2 pr-3" style={{ color: s.trendPct >= 0 ? 'var(--domain-finops)' : 'var(--sev-high)' }}>
                      {s.trendPct >= 0 ? '▲' : '▼'} {Math.abs(s.trendPct)}%
                    </td>
                    <td className="py-2 pr-3">{s.cost > 0 ? fmtUsd(s.cost) : '—'}</td>
                    <td className="py-2 pr-3">{s.setupScore}%</td>
                    <td className="py-2 pr-3"><StatusPill status={s.status} label={t('geniespaces.status.' + s.status.replace(' ', ''))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{t('geniespaces.footnote')}</p>
      </section>
    </div>
  );
}
