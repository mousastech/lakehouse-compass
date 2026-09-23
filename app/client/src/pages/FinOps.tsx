import { useMemo, useState } from 'react';
import { DollarSign, Cpu, UserX, Wifi, WifiOff, X } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { normCost } from '../lib/model';
import { toStr, toNum } from '../lib/rows';
import { useT } from '../lib/i18n';
import { fmtUsd, fmtDate } from '../lib/format';
import { KpiCard } from '../components/KpiCard';
import { Treemap, type TreemapItem } from '../components/Treemap';
import { CostTrend } from '../components/CostTrend';

const PALETTE = [
  '--domain-performance',
  '--domain-finops',
  '--domain-ai_estate',
  '--domain-lakebase',
  '--domain-genie',
  '--domain-usage',
  '--domain-governance',
  '--sev-high',
];

export function FinOps() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows, loading, source } = useLiveRows('cost_summary', '/api/rows/cost_summary', ws);
  const cost = useMemo(() => rows.map(normCost), [rows]);
  const { rows: detailRows } = useLiveRows('cost_detail', '/api/rows/cost_detail', ws);
  const trendQ = useLiveRows('trend', '/api/rows/trend', ws);
  const lastScanAt = toStr(trendQ.rows[0]?.generated_at);
  const [selected, setSelected] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [unattrOpen, setUnattrOpen] = useState(false);

  const parseTags = (v: unknown): Record<string, string> => {
    if (typeof v === 'string' && v.trim().startsWith('{')) {
      try {
        const o = JSON.parse(v);
        return o && typeof o === 'object' ? (o as Record<string, string>) : {};
      } catch {
        return {};
      }
    }
    return {};
  };

  const detail = useMemo(
    () =>
      detailRows.map((r) => {
        const identity = toStr(r.identity) || '(unattributed)';
        const owner = toStr(r.owner);
        return {
          product: toStr(r.product),
          sku: toStr(r.sku),
          identity,
          resourceType: toStr(r.resource_type),
          resourceName: toStr(r.resource_name) || '—',
          owner,
          tags: parseTags(r.tags_json),
          // Effective attribution: fall back to owner when run-as is unattributed.
          attributedTo: identity !== '(unattributed)' ? identity : owner || '(unattributed)',
          viaOwner: identity === '(unattributed)' && !!owner,
          costUsd: toNum(r.cost_usd),
          dbus: toNum(r.dbus),
        };
      }),
    [detailRows],
  );

  const selectProduct = (p: string) => {
    setSelected(p);
    setUserFilter('');
    setTagFilter('');
  };

  const drillBase = useMemo(() => detail.filter((d) => d.product === selected), [detail, selected]);
  const users = useMemo(
    () => [...new Set(drillBase.flatMap((d) => [d.identity, d.owner].filter((x) => x && x !== '(unattributed)')))].sort(),
    [drillBase],
  );
  const tagPairs = useMemo(
    () => [...new Set(drillBase.flatMap((d) => Object.entries(d.tags).map(([k, v]) => `${k}=${v}`)))].sort(),
    [drillBase],
  );
  const drill = useMemo(
    () =>
      drillBase
        .filter((d) => {
          if (userFilter && d.identity !== userFilter && d.owner !== userFilter) return false;
          if (tagFilter) {
            const eq = tagFilter.indexOf('=');
            const k = tagFilter.slice(0, eq);
            const v = tagFilter.slice(eq + 1);
            if (d.tags[k] !== v) return false;
          }
          return true;
        })
        .sort((a, b) => b.costUsd - a.costUsd),
    [drillBase, userFilter, tagFilter],
  );
  // Fallback when the per-resource detail is unavailable: identity/SKU from summary.
  const drillFallback = useMemo(
    () => cost.filter((c) => c.product === selected).sort((a, b) => b.costUsd - a.costUsd),
    [cost, selected],
  );
  const drillTotal = (drill.length ? drill : drillFallback).reduce((a, c) => a + c.costUsd, 0);

  const total = cost.reduce((a, c) => a + c.costUsd, 0);
  const ai = cost.filter((c) => c.isAi).reduce((a, c) => a + c.costUsd, 0);
  const unattributed = cost.filter((c) => c.identity === '(unattributed)').reduce((a, c) => a + c.costUsd, 0);
  const unattributedPct = total > 0 ? Math.round((100 * unattributed) / total) : 0;

  // What is inside "unattributed": the cost_detail rows with no run-as identity,
  // grouped by resource + effective owner (owned_by/created_by) — usually
  // warehouses, Apps, jobs/pipelines serverless and notebooks.
  const unattrDetail = useMemo(() => {
    const m = new Map<string, { product: string; resourceType: string; resourceName: string; owner: string; cost: number; dbus: number }>();
    for (const d of detail) {
      if (d.identity !== '(unattributed)') continue;
      const key = `${d.product}|${d.resourceType}|${d.resourceName}|${d.owner}`;
      const cur = m.get(key) || { product: d.product, resourceType: d.resourceType, resourceName: d.resourceName, owner: d.owner, cost: 0, dbus: 0 };
      cur.cost += d.costUsd;
      cur.dbus += d.dbus;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost);
  }, [detail]);

  const byProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cost) m.set(c.product, (m.get(c.product) ?? 0) + c.costUsd);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [cost]);

  const byIdentity = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cost) m.set(c.identity, (m.get(c.identity) ?? 0) + c.costUsd);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [cost]);

  const treemapItems: TreemapItem[] = byProduct.map(([product, value], i) => ({
    label: product,
    value,
    colorVar: PALETTE[i % PALETTE.length],
  }));
  const maxIdentity = byIdentity[0]?.[1] ?? 1;

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t('nav.finops')}</h1>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{
            color: source === 'live' ? 'var(--domain-finops)' : 'var(--sev-medium)',
            background: `color-mix(in oklch, var(${source === 'live' ? '--domain-finops' : '--sev-medium'}) 16%, transparent)`,
          }}
        >
          {source === 'live' ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {source === 'live' ? t('meta.live') : t('meta.demoMode')}
        </span>
      </div>

      <p className="-mt-2 text-xs text-muted-foreground">
        {t('finops.windowNote')}{lastScanAt ? ` · ${t('meta.lastScan')}: ${fmtDate(lastScanAt)}` : ''}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label={t('finops.totalSpend')} value={fmtUsd(total)} accentVar="--domain-finops" icon={<DollarSign className="h-4 w-4" />} />
        <KpiCard label={t('finops.aiSpend')} value={fmtUsd(ai)} sub={`${total ? Math.round((100 * ai) / total) : 0}% of total`} accentVar="--domain-ai_estate" icon={<Cpu className="h-4 w-4" />} />
        <button type="button" onClick={() => setUnattrOpen((v) => !v)} className="w-full text-left" title={t('finops.unattrClick')}>
          <KpiCard
            label={t('finops.unattributed')}
            value={fmtUsd(unattributed)}
            sub={`${unattributedPct}% · ${t('finops.unattrClick')}`}
            accentVar="--sev-high"
            icon={<UserX className="h-4 w-4" />}
          />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t('finops.kpiHelp')}</p>

      <CostTrend ws={ws} />

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-card-foreground">{t('finops.byProduct')}</h2>
          <span className="text-xs text-muted-foreground">{t('finops.clickToDrill')}</span>
        </div>
        {loading ? (
          <div className="h-[260px] animate-pulse rounded-lg bg-muted" />
        ) : treemapItems.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t('finops.noData')}</p>
        ) : (
          <Treemap items={treemapItems} height={260} onSelect={selectProduct} selected={selected} />
        )}
      </section>

      {unattrOpen && (
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-card-foreground">
              {t('finops.unattrTitle')}
              <span className="ml-2 text-xs font-normal text-muted-foreground">{fmtUsd(unattributed)} · {unattributedPct}%</span>
            </h2>
            <button
              type="button"
              onClick={() => setUnattrOpen(false)}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
            >
              <X className="h-3.5 w-3.5" /> {t('finops.clear')}
            </button>
          </div>
          <p className="mb-3 text-[11px] text-muted-foreground">{t('finops.unattrHelp')}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{t('finops.col.resource')}</th>
                  <th className="py-2 pr-3 font-medium">{t('finops.col.owner')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('finops.col.dbus')}</th>
                  <th className="py-2 text-right font-medium">{t('finops.col.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {unattrDetail.length === 0 ? (
                  <tr><td colSpan={4} className="py-4 text-center text-sm text-muted-foreground">{t('finops.drillNone')}</td></tr>
                ) : (
                  unattrDetail.map((d, i) => (
                    <tr key={`${d.resourceName}-${i}`} className="border-b border-border/60">
                      <td className="py-2 pr-3">
                        <span className="text-card-foreground">{d.resourceName}</span>
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{d.resourceType}</span>
                        <div className="text-[11px] text-muted-foreground">{d.product}</div>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {d.owner || '—'}
                        {d.owner && <span className="ml-1 text-[10px] text-muted-foreground">{t('finops.viaOwner')}</span>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{Math.round(d.dbus).toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums text-card-foreground">{fmtUsd(d.cost)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selected && (
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-card-foreground">
              {t('finops.drillTitle')} <span className="font-mono">{selected}</span>
              <span className="ml-2 text-xs font-normal text-muted-foreground">{fmtUsd(drillTotal)}</span>
            </h2>
            <button
              type="button"
              onClick={() => setSelected('')}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
            >
              <X className="h-3.5 w-3.5" /> {t('finops.clear')}
            </button>
          </div>

          {(users.length > 0 || tagPairs.length > 0) && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {users.length > 0 && (
                <select
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                >
                  <option value="">{t('finops.allUsers')}</option>
                  {users.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              )}
              {tagPairs.length > 0 && (
                <select
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                >
                  <option value="">{t('finops.allTags')}</option>
                  {tagPairs.map((tp) => (
                    <option key={tp} value={tp}>{tp}</option>
                  ))}
                </select>
              )}
              {(userFilter || tagFilter) && (
                <button
                  type="button"
                  onClick={() => { setUserFilter(''); setTagFilter(''); }}
                  className="text-xs text-muted-foreground underline"
                >
                  {t('finops.resetFilters')}
                </button>
              )}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{t('finops.col.resource')}</th>
                  <th className="py-2 pr-3 font-medium">{t('finops.col.identity')}</th>
                  <th className="py-2 pr-3 font-medium">{t('finops.col.owner')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('finops.col.dbus')}</th>
                  <th className="py-2 text-right font-medium">{t('finops.col.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {drill.length > 0 ? (
                  drill.map((d, i) => (
                    <tr key={`${d.resourceName}-${d.identity}-${i}`} className="border-b border-border/60">
                      <td className="py-2 pr-3">
                        <span className="text-card-foreground">{d.resourceName}</span>
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{d.resourceType}</span>
                        <div className="text-[11px] text-muted-foreground">{d.sku}</div>
                        {Object.keys(d.tags).length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {Object.entries(d.tags).map(([k, v]) => (
                              <span key={k} className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">{k}={v}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3" style={{ color: d.attributedTo === '(unattributed)' ? 'var(--sev-high)' : undefined }}>
                        {d.attributedTo}
                        {d.viaOwner && <span className="ml-1 text-[10px] text-muted-foreground">{t('finops.viaOwner')}</span>}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{d.owner || '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{Math.round(d.dbus).toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums text-card-foreground">{fmtUsd(d.costUsd)}</td>
                    </tr>
                  ))
                ) : drillFallback.length > 0 ? (
                  drillFallback.map((c, i) => (
                    <tr key={`${c.sku}-${c.identity}-${i}`} className="border-b border-border/60">
                      <td className="py-2 pr-3">
                        <span className="text-card-foreground">{c.sku || '—'}</span>
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">sku</span>
                      </td>
                      <td className="py-2 pr-3" style={{ color: c.identity === '(unattributed)' ? 'var(--sev-high)' : undefined }}>{c.identity}</td>
                      <td className="py-2 pr-3 text-muted-foreground">—</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{Math.round(c.dbus).toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums text-card-foreground">{fmtUsd(c.costUsd)}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={5} className="py-4 text-center text-sm text-muted-foreground">{t('finops.drillNone')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {drill.length === 0 && drillFallback.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">{t('finops.drillFallback')}</p>
          )}
        </section>
      )}

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('finops.byIdentity')}</h2>
        <ul className="space-y-2">
          {byIdentity.length === 0 && <li className="text-sm text-muted-foreground">—</li>}
          {byIdentity.map(([ident, usd]) => {
            const isUnattributed = ident === '(unattributed)';
            return (
              <li key={ident} className="flex items-center gap-3">
                <span className="w-56 shrink-0 truncate text-sm" style={{ color: isUnattributed ? 'var(--sev-high)' : 'var(--foreground)' }}>
                  {ident}
                </span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(2, (100 * usd) / maxIdentity)}%`,
                      background: isUnattributed ? 'var(--sev-high)' : 'var(--domain-finops)',
                      transition: 'width var(--dur-slow) var(--ease)',
                    }}
                  />
                </div>
                <span className="tnum w-24 shrink-0 text-right text-sm text-muted-foreground">{fmtUsd(usd)}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
