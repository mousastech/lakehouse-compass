import { useMemo } from 'react';
import { Server, Database, AlertTriangle } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { toNum, toStr, toBool } from '../lib/rows';
import { useT } from '../lib/i18n';
import { SourceBadge, NotAvailable } from '../components/SourceBadge';
import { Scatter, type Bubble } from '../components/Scatter';
import { FindingsList } from '../components/FindingsList';

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dbu = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

function ComputeInventory() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows, loading, source } = useLiveRows('compute_inventory', '/api/rows/compute_inventory', ws);

  const maxCost = Math.max(1, ...rows.map((r) => toNum(r.cost_usd_30d)));

  if (loading) return <p className="text-sm text-muted-foreground">…</p>;
  if (rows.length === 0) {
    return <NotAvailable title={t('perf.compute.naTitle')} reason={t('perf.compute.naReason')} />;
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-card-foreground">{t('perf.compute.title')}</h2>
        <SourceBadge source={source} />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t('perf.compute.note')}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">{t('perf.compute.colName')}</th>
              <th className="py-1.5 pr-3 font-medium">{t('perf.compute.colKind')}</th>
              <th className="py-1.5 pr-3 font-medium">{t('perf.compute.colConfig')}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t('perf.compute.colQueries')}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t('perf.compute.colP90')}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t('perf.compute.colDbus')}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t('perf.compute.colCost')}</th>
              <th className="py-1.5 font-medium">{t('perf.compute.colHealth')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const kind = toStr(r.kind);
              const isWh = kind === 'warehouse';
              const serverless = r.serverless == null ? null : toBool(r.serverless);
              const autoStop = toNum(r.auto_stop_min);
              const dbr = toStr(r.dbr_version);
              const chips: string[] = [];
              if (isWh && autoStop <= 0) chips.push(t('perf.compute.noAutoStop'));
              if (isWh && serverless === false) chips.push(t('perf.compute.classic'));
              if (!isWh && autoStop <= 0) chips.push(t('perf.compute.noAutoTerm'));
              if (!isWh && /^(\d+)/.test(dbr) && parseInt(dbr, 10) < 14) chips.push(t('perf.compute.oldDbr'));
              const config = isWh
                ? `${toStr(r.size)}${serverless ? ' · serverless' : ' · classic'}${autoStop > 0 ? ` · auto-stop ${autoStop}m` : ''}`
                : `${dbr || '—'}${autoStop > 0 ? ` · auto-term ${autoStop}m` : ''} · ${toNum(r.min_clusters)}–${toNum(r.max_clusters)}`;
              return (
                <tr key={`${toStr(r.compute_id)}-${i}`} className="border-t border-border/60 align-top">
                  <td className="py-1.5 pr-3 text-card-foreground">{toStr(r.name)}</td>
                  <td className="py-1.5 pr-3">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      {isWh ? <Database className="h-3.5 w-3.5" /> : <Server className="h-3.5 w-3.5" />}
                      {isWh ? t('perf.compute.warehouse') : t('perf.compute.cluster')}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{config}</td>
                  <td className="tnum py-1.5 pr-3 text-right text-muted-foreground">{isWh ? toNum(r.queries_30d).toLocaleString() : '—'}</td>
                  <td className="tnum py-1.5 pr-3 text-right text-muted-foreground">{isWh && toNum(r.p90_ms) > 0 ? `${(toNum(r.p90_ms) / 1000).toFixed(1)}s` : '—'}</td>
                  <td className="tnum py-1.5 pr-3 text-right text-muted-foreground">{dbu(toNum(r.dbus_30d))}</td>
                  <td className="py-1.5 pr-3 text-right">
                    <div className="tnum text-card-foreground">{usd(toNum(r.cost_usd_30d))}</div>
                    <div className="mt-1 h-1.5 w-full min-w-[60px] rounded-full bg-muted">
                      <div className="h-1.5 rounded-full" style={{ width: `${Math.round((toNum(r.cost_usd_30d) / maxCost) * 100)}%`, background: 'var(--domain-finops)' }} />
                    </div>
                  </td>
                  <td className="py-1.5">
                    {chips.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {chips.map((c) => (
                          <span key={c} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]" style={{ color: 'var(--sev-medium)', background: 'color-mix(in oklch, var(--sev-medium) 12%, transparent)' }}>
                            <AlertTriangle className="h-3 w-3" /> {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Performance() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows, source } = useLiveRows('perf_summary', '/api/rows/perf_summary', ws);
  const bubbles: Bubble[] = useMemo(
    () => rows.map((r) => ({ label: toStr(r.entity), x: toNum(r.queries), y: toNum(r.avg_ms) })),
    [rows]
  );

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t('nav.performance')}</h1>
        <SourceBadge source={source} />
      </div>

      <ComputeInventory />

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold text-card-foreground">{t('perf.scatter')}</h2>
        <p className="mb-3 text-xs text-muted-foreground">{t('perf.scatterNote')}</p>
        <Scatter bubbles={bubbles} xLabel={t('perf.queries')} yLabel={t('perf.avgMs')} />
      </section>
      <FindingsList domain="performance" />
    </div>
  );
}
