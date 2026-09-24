import { useMemo, useState } from 'react';
import { BrainCircuit, Cpu, ShieldAlert, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { useApi } from '../lib/api';
import { normCost } from '../lib/model';
import { toStr, toNum, toBool } from '../lib/rows';
import { useT } from '../lib/i18n';
import { fmtUsd } from '../lib/format';
import { KpiCard } from '../components/KpiCard';
import { SourceBadge } from '../components/SourceBadge';
import { FindingsList } from '../components/FindingsList';

interface Gov {
  endpoint?: string;
  usage_tracking?: boolean;
  guardrails?: boolean;
  payload_logging?: boolean;
  fully_governed?: boolean;
}
interface Requester { requester: string; requests: number }

function parseArr<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? (p as T[]) : []; } catch { return []; }
  }
  return [];
}

const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
      style={{
        color: ok ? 'var(--domain-finops)' : 'var(--sev-medium)',
        background: `color-mix(in oklch, var(${ok ? '--domain-finops' : '--sev-medium'}) 15%, transparent)`,
      }}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} {label}
    </span>
  );
}

export function AIEstate() {
  const t = useT();
  const { ws } = useWorkspace();
  const endpoints = useLiveRows('ai_estate', '/api/rows/ai_estate', ws);
  const gwQ = useLiveRows('ai_gateway_config', '/api/rows/ai_gateway_config', ws);
  const usageQ = useLiveRows('endpoint_usage_summary', '/api/rows/endpoint_usage_summary', ws);
  const cost = useLiveRows('cost_summary', '/api/rows/cost_summary', ws);
  const { data: gov } = useApi<Gov>('/api/agent/governance', {});
  const [drill, setDrill] = useState('');

  const aiUsd = useMemo(
    () => cost.rows.map(normCost).filter((c) => c.isAi).reduce((a, c) => a + c.costUsd, 0),
    [cost.rows]
  );
  const eps = endpoints.rows;
  const individual = eps.filter((e) => toStr(e.owner).includes('@')).length;

  const rows = useMemo(() => {
    const gwBy = new Map(gwQ.rows.map((r) => [toStr(r.endpoint_name), r]));
    const usageBy = new Map(usageQ.rows.map((r) => [toStr(r.endpoint_name), r]));
    // Union of endpoints seen in inventory + gateway + usage.
    const names = new Set<string>([
      ...eps.map((e) => toStr(e.endpoint_name)),
      ...gwQ.rows.map((r) => toStr(r.endpoint_name)),
      ...usageQ.rows.map((r) => toStr(r.endpoint_name)),
    ]);
    return Array.from(names).filter(Boolean).map((name) => {
      const gw = gwBy.get(name);
      const u = usageBy.get(name);
      const inv = eps.find((e) => toStr(e.endpoint_name) === name);
      return {
        name,
        entityType: toStr(inv?.entity_type),
        owner: toStr(inv?.owner),
        hasGw: !!gw,
        tracking: toBool(gw?.usage_tracking),
        payload: toBool(gw?.payload_logging),
        rate: toBool(gw?.rate_limits),
        guardrails: toBool(gw?.guardrails),
        governed: toBool(gw?.governed),
        requests: toNum(u?.requests_30d),
        requesters: toNum(u?.requesters),
        inTokens: toNum(u?.in_tokens),
        outTokens: toNum(u?.out_tokens),
        errorRate: toNum(u?.error_rate),
        lastRequest: toStr(u?.last_request).slice(0, 16).replace('T', ' '),
        topRequesters: parseArr<Requester>(u?.top_requesters_json),
      };
    }).sort((a, b) => b.requests - a.requests);
  }, [eps, gwQ.rows, usageQ.rows]);

  const governedCount = rows.filter((r) => r.governed).length;
  const selected = rows.find((r) => r.name === drill);
  const source = gwQ.source === 'live' || usageQ.source === 'live' ? 'live' : endpoints.source;

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t('nav.ai_estate')}</h1>
        <SourceBadge source={source} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label={t('aie.endpoints')} value={eps.length} accentVar="--domain-ai_estate" icon={<BrainCircuit className="h-4 w-4" />} />
        <KpiCard label={t('aie.governed')} value={`${governedCount}/${rows.length}`} sub={`${rows.length ? Math.round((100 * governedCount) / rows.length) : 0}% ${t('aie.governedPct')}`} accentVar="--domain-finops" icon={<ShieldCheck className="h-4 w-4" />} />
        <KpiCard label={t('aie.aiSpend')} value={fmtUsd(aiUsd)} accentVar="--domain-finops" icon={<Cpu className="h-4 w-4" />} />
        <KpiCard label={t('aie.individual')} value={individual} accentVar="--sev-high" />
      </div>

      {gov?.endpoint && (
        <div
          className="flex items-start gap-2 rounded-xl border p-3 text-sm"
          style={{
            borderColor: gov.fully_governed ? 'var(--domain-finops)' : 'var(--sev-medium)',
            color: gov.fully_governed ? 'var(--domain-finops)' : 'var(--sev-medium)',
          }}
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t('aie.govStatus')} <b>{gov.endpoint}</b>: usage_tracking={String(!!gov.usage_tracking)}, guardrails={String(!!gov.guardrails)}, payload_logging={String(!!gov.payload_logging)}.
            {!gov.fully_governed && ` ${t('aie.govGap')} [AIG-004]`}
          </span>
        </div>
      )}

      {/* Per-endpoint AI Gateway governance + usage */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-2.5 text-sm font-semibold text-card-foreground">{t('aie.gatewayTitle')}</div>
        <p className="px-4 pt-2 text-xs text-muted-foreground">{t('aie.gatewayHelp')}</p>
        <div className="overflow-x-auto p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t('aie.col.endpoint')}</th>
                <th className="px-3 py-2 font-medium">{t('aie.col.governance')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('aie.col.requests')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('aie.col.requesters')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('aie.col.errors')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('aie.none')}</td></tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.name}
                  onClick={() => setDrill((d) => (d === r.name ? '' : r.name))}
                  className="cursor-pointer border-b border-border/50 align-top transition-colors hover:bg-accent/50"
                >
                  <td className="px-3 py-2">
                    <div className="text-card-foreground">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground">{r.entityType}{r.owner ? ` · ${r.owner}` : ''}</div>
                  </td>
                  <td className="px-3 py-2">
                    {r.hasGw ? (
                      <div className="flex flex-wrap gap-1">
                        <Chip ok={r.governed} label={r.governed ? t('aie.governedYes') : t('aie.governedPartial')} />
                        <Chip ok={r.tracking} label={t('aie.tracking')} />
                        <Chip ok={r.payload} label={t('aie.payload')} />
                        <Chip ok={r.rate} label={t('aie.rate')} />
                        <Chip ok={r.guardrails} label={t('aie.guardrails')} />
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">{t('aie.gwUnknown')}</span>
                    )}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-muted-foreground">{num(r.requests)}</td>
                  <td className="tnum px-3 py-2 text-right text-muted-foreground">{num(r.requesters)}</td>
                  <td className="tnum px-3 py-2 text-right" style={{ color: r.errorRate > 5 ? 'var(--sev-high)' : undefined }}>{r.errorRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selected && (
          <div className="border-t border-border bg-muted/30 p-4 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-card-foreground">{selected.name}</span>
              <span className="text-[11px] text-muted-foreground">{t('aie.lastRequest')}: {selected.lastRequest || '—'}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-[11px] uppercase text-muted-foreground">{t('aie.tokens')}</p>
                <p className="tnum mt-1 text-card-foreground">{num(selected.inTokens)} in · {num(selected.outTokens)} out</p>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-[11px] uppercase text-muted-foreground">{t('aie.col.requests')} (30d)</p>
                <p className="tnum mt-1 text-card-foreground">{num(selected.requests)} · {selected.errorRate}% err</p>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-[11px] uppercase text-muted-foreground">{t('aie.col.governance')}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Chip ok={selected.tracking} label={t('aie.tracking')} />
                  <Chip ok={selected.payload} label={t('aie.payload')} />
                  <Chip ok={selected.rate} label={t('aie.rate')} />
                  <Chip ok={selected.guardrails} label={t('aie.guardrails')} />
                </div>
              </div>
            </div>
            <div className="mt-3">
              <p className="mb-1 text-[11px] uppercase text-muted-foreground">{t('aie.whoUsing')}</p>
              {selected.topRequesters.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
              <div className="space-y-1">
                {selected.topRequesters.map((q) => (
                  <div key={toStr(q.requester)} className="flex items-center justify-between text-xs">
                    <span className="truncate text-card-foreground">{toStr(q.requester)}</span>
                    <span className="tnum text-muted-foreground">{num(toNum(q.requests))} {t('aie.reqs')}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <FindingsList domain="ai_estate" />
      <p className="text-xs text-muted-foreground">{t('aie.note')}</p>
    </div>
  );
}
