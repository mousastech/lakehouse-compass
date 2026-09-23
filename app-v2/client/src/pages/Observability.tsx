import { useMemo, useState } from 'react';
import { DollarSign, TrendingUp, TrendingDown, Package, Users, Clock, BarChart3, Boxes, Calendar } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { useT } from '../lib/i18n';
import { toNum, toStr, toBool } from '../lib/rows';
import { fmtUsd } from '../lib/format';
import { SourceBadge } from '../components/SourceBadge';
import { KpiCard } from '../components/KpiCard';
import { CostTrend } from '../components/CostTrend';
import { Heatmap, type HeatCell } from '../components/Heatmap';
import { Treemap, type TreemapItem } from '../components/Treemap';

// Consumption/billing observability: what is billed, how much, when, how, trends,
// history — all from system.billing.usage-derived Delta tables (same as v1).
const PALETTE = ['--domain-finops', '--domain-usage', '--domain-genie', '--primary', '--sev-medium', '--sev-low', '--domain-security'];

interface DrillRow {
  resourceType: string; resourceName: string; attributedTo: string; viaOwner: boolean; dbus: number; cost: number;
}

export function Observability() {
  const t = useT();
  const { ws } = useWorkspace();
  const trendQ = useLiveRows('cost_trend', '/api/rows/cost_trend', ws);
  const summaryQ = useLiveRows('cost_summary', '/api/rows/cost_summary', ws);
  const detailQ = useLiveRows('cost_detail', '/api/rows/cost_detail', ws);
  const heatQ = useLiveRows('usage_heatmap', '/api/rows/usage_heatmap', ws);
  const invQ = useLiveRows('compute_inventory', '/api/rows/compute_inventory', ws);
  const scanQ = useLiveRows('trend', '/api/rows/trend', ws);
  const [selected, setSelected] = useState('');

  // Daily totals (summed across products) for the KPI band + monthly history.
  const daily = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of trendQ.rows) { const d = toStr(r.usage_date); if (d) m.set(d, (m.get(d) || 0) + toNum(r.cost_usd)); }
    return Array.from(m.entries()).map(([date, cost]) => ({ date, cost })).sort((a, b) => a.date.localeCompare(b.date));
  }, [trendQ.rows]);

  const { last30, prev30 } = useMemo(() => {
    if (daily.length === 0) return { last30: 0, prev30: 0 };
    const last = new Date(daily[daily.length - 1].date);
    const d1 = new Date(last); d1.setUTCDate(d1.getUTCDate() - 29);
    const d2 = new Date(last); d2.setUTCDate(d2.getUTCDate() - 59);
    const c1 = d1.toISOString().slice(0, 10); const c2 = d2.toISOString().slice(0, 10);
    let a = 0, b = 0;
    for (const p of daily) { if (p.date >= c1) a += p.cost; else if (p.date >= c2) b += p.cost; }
    return { last30: a, prev30: b };
  }, [daily]);
  const deltaPct = prev30 > 0 ? Math.round(((last30 - prev30) / prev30) * 100) : 0;
  const up = deltaPct >= 0;

  const byProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of summaryQ.rows) { const p = toStr(r.product) || '—'; m.set(p, (m.get(p) || 0) + toNum(r.cost_usd)); }
    return Array.from(m.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [summaryQ.rows]);
  const topProduct = byProduct[0]?.label ?? '—';

  const activeIdentities = useMemo(() => {
    const s = new Set<string>();
    for (const r of detailQ.rows) {
      const id = toStr(r.identity); const owner = toStr(r.owner);
      const eff = id && id !== '(unattributed)' ? id : owner;
      if (eff) s.add(eff);
    }
    return s.size;
  }, [detailQ.rows]);

  const treemapItems: TreemapItem[] = byProduct.map((p, i) => ({
    label: p.label, value: p.value, colorVar: PALETTE[i % PALETTE.length], detail: fmtUsd(p.value),
  }));

  const drill = useMemo<DrillRow[]>(() => {
    if (!selected) return [];
    return detailQ.rows
      .filter((r) => toStr(r.product) === selected)
      .map((r) => {
        const id = toStr(r.identity); const owner = toStr(r.owner);
        return {
          resourceType: toStr(r.resource_type), resourceName: toStr(r.resource_name) || '—',
          attributedTo: id && id !== '(unattributed)' ? id : (owner || '(unattributed)'),
          viaOwner: id === '(unattributed)' && !!owner,
          dbus: toNum(r.dbus), cost: toNum(r.cost_usd),
        };
      })
      .sort((a, b) => b.cost - a.cost).slice(0, 50);
  }, [detailQ.rows, selected]);

  const heatCells: HeatCell[] = heatQ.rows.map((r) => ({ dow: toNum(r.dow), hour: toNum(r.hour), n: toNum(r.n) }));

  const inventory = useMemo(() => invQ.rows.map((r) => ({
    name: toStr(r.name) || toStr(r.compute_id), kind: toStr(r.kind), size: toStr(r.size),
    serverless: toBool(r.serverless), dbr: toStr(r.dbr_version), state: toStr(r.state),
    queries: toNum(r.queries_30d), dbus: toNum(r.dbus_30d), cost: toNum(r.cost_usd_30d),
  })), [invQ.rows]);

  const monthly = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of daily) { const k = p.date.slice(0, 7); m.set(k, (m.get(k) || 0) + p.cost); }
    return Array.from(m.entries()).map(([month, cost]) => ({ month, cost })).sort((a, b) => a.month.localeCompare(b.month));
  }, [daily]);
  const maxMonth = Math.max(1, ...monthly.map((x) => x.cost));

  const lastScan = toStr(scanQ.rows[0]?.generated_at).slice(0, 16).replace('T', ' ');

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t('obs.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('obs.subtitle')}{lastScan ? ` · ${t('meta.lastScan')}: ${lastScan}` : ''}
          </p>
        </div>
        <SourceBadge source={trendQ.source} />
      </div>

      {/* KPI band */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={t('obs.kpi.total')} value={fmtUsd(last30)} accentVar="--domain-finops" icon={<DollarSign className="h-4 w-4" />} />
        <KpiCard
          label={t('obs.kpi.delta')}
          value={<span style={{ color: `var(${up ? '--sev-medium' : '--domain-finops'})` }}>{up ? '+' : ''}{deltaPct}%</span>}
          sub={t('obs.kpi.deltaSub')}
          accentVar={up ? '--sev-medium' : '--domain-finops'}
          icon={up ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
        />
        <KpiCard label={t('obs.kpi.topProduct')} value={topProduct} accentVar="--domain-usage" icon={<Package className="h-4 w-4" />} />
        <KpiCard label={t('obs.kpi.identities')} value={String(activeIdentities)} accentVar="--primary" icon={<Users className="h-4 w-4" />} />
      </div>

      {/* Quando / Tendência */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Clock className="h-4 w-4" style={{ color: 'var(--domain-usage)' }} /> {t('obs.when')}</h2>
        <CostTrend ws={ws} />
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-card-foreground">{t('obs.heatmap')}</h3>
          <Heatmap cells={heatCells} />
        </div>
      </section>

      {/* O quê / Quanto / Como — breakdown + drill */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><BarChart3 className="h-4 w-4" style={{ color: 'var(--domain-finops)' }} /> {t('obs.breakdown')}</h2>
        <p className="text-xs text-muted-foreground">{t('obs.breakdownHelp')}</p>
        <div className="rounded-xl border border-border bg-card p-4">
          {treemapItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <Treemap items={treemapItems} onSelect={(l) => setSelected(l === selected ? '' : l)} selected={selected} />
          )}
        </div>
        {selected && (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-card-foreground">{t('obs.drillTitle')} {selected}</h3>
              <button type="button" onClick={() => setSelected('')} className="text-xs text-muted-foreground hover:text-foreground">{t('obs.clear')}</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">{t('obs.col.resource')}</th>
                    <th className="py-1.5 pr-3 font-medium">{t('obs.col.type')}</th>
                    <th className="py-1.5 pr-3 font-medium">{t('obs.col.attributed')}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t('obs.col.dbus')}</th>
                    <th className="py-1.5 text-right font-medium">{t('obs.col.cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {drill.length === 0 && <tr><td colSpan={5} className="py-2 text-muted-foreground">—</td></tr>}
                  {drill.map((d, i) => (
                    <tr key={`${d.resourceName}-${i}`} className="border-t border-border/60">
                      <td className="py-1.5 pr-3 text-card-foreground">{d.resourceName}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{d.resourceType}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{d.attributedTo}{d.viaOwner ? ` ${t('obs.viaOwner')}` : ''}</td>
                      <td className="tnum py-1.5 pr-3 text-right text-muted-foreground">{d.dbus.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                      <td className="tnum py-1.5 text-right text-card-foreground">{fmtUsd(d.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Inventário do que roda */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Boxes className="h-4 w-4" style={{ color: 'var(--domain-genie)' }} /> {t('obs.inventory')}</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t('obs.col.name')}</th>
                  <th className="px-3 py-2 font-medium">{t('obs.col.kind')}</th>
                  <th className="px-3 py-2 font-medium">{t('obs.col.config')}</th>
                  <th className="px-3 py-2 font-medium">{t('obs.col.state')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('obs.col.queries')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('obs.col.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {inventory.length === 0 && <tr><td colSpan={6} className="px-3 py-3 text-muted-foreground">{t('obs.noInventory')}</td></tr>}
                {inventory.map((c, i) => (
                  <tr key={`${c.name}-${i}`} className="border-b border-border/50">
                    <td className="px-3 py-2 text-card-foreground">{c.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{c.kind}</td>
                    <td className="px-3 py-2 text-muted-foreground">{[c.size, c.serverless ? 'serverless' : '', c.dbr].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{c.state || '—'}</td>
                    <td className="tnum px-3 py-2 text-right text-muted-foreground">{c.queries.toLocaleString()}</td>
                    <td className="tnum px-3 py-2 text-right text-card-foreground">{fmtUsd(c.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Histórico / revisão */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Calendar className="h-4 w-4" style={{ color: 'var(--primary)' }} /> {t('obs.history')}</h2>
        <div className="rounded-xl border border-border bg-card p-4">
          {monthly.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <div className="space-y-2">
              {monthly.map((m) => (
                <div key={m.month} className="flex items-center gap-3">
                  <span className="tnum w-16 shrink-0 text-xs text-muted-foreground">{m.month}</span>
                  <div className="h-3 flex-1 rounded-full bg-muted">
                    <div className="h-3 rounded-full" style={{ width: `${Math.round((m.cost / maxMonth) * 100)}%`, background: 'var(--domain-finops)' }} />
                  </div>
                  <span className="tnum w-24 shrink-0 text-right text-xs text-card-foreground">{fmtUsd(m.cost)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
