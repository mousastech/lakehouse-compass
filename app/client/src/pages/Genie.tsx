import { Sparkles, CheckCircle2, AlertTriangle, DollarSign, Gauge, Gift, Users } from 'lucide-react';
import { useApi } from '../lib/api';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { useT } from '../lib/i18n';
import { toNum, toStr, toBool } from '../lib/rows';
import { NotAvailable, SourceBadge } from '../components/SourceBadge';
import { FindingsList } from '../components/FindingsList';

interface GenieSpace {
  space_id: string;
  title: string;
  has_description: boolean;
  tables: number;
  warehouse: string;
}
interface GenieResp {
  available?: boolean;
  reason?: string;
  total?: number;
  sampled?: number;
  spaces?: GenieSpace[];
}

interface SurfaceRow { surface: string; list_cost: number; dbus: number }
interface TrendRow { usage_date: string; list_cost: number }

// The analytics plugin auto-parses valid-JSON string columns in live mode, so the
// value may already be an array; in demo/fixture mode it is a JSON string.
function parseArr<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? (p as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dbu = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

function CostConsumption() {
  const t = useT();
  const { ws } = useWorkspace();
  const summaryQ = useLiveRows('genie_cost_summary', '/api/rows/genie_cost_summary', ws);
  const usersQ = useLiveRows('genie_cost_by_user', '/api/rows/genie_cost_by_user', ws);

  if (summaryQ.loading) return <p className="text-sm text-muted-foreground">…</p>;

  const s = summaryQ.rows[0];
  if (!s) {
    return <NotAvailable title={t('genie.cost.naTitle')} reason={t('genie.cost.naReason')} />;
  }

  const windowDays = toNum(s.window_days) || 30;
  const billedCost = toNum(s.billed_cost_usd);
  const billedDbus = toNum(s.billed_dbus);
  const freeDbus = toNum(s.free_dbus);
  const activeUsers = toNum(s.active_users);
  const surfaces = parseArr<SurfaceRow>(s.by_surface_json);
  const trend = parseArr<TrendRow>(s.trend_json);

  const maxDbus = Math.max(1, ...surfaces.map((x) => toNum(x.dbus)));
  const maxTrend = Math.max(1, ...trend.map((x) => toNum(x.list_cost)));

  const kpis = [
    { icon: DollarSign, label: t('genie.cost.billedCost'), value: usd(billedCost), color: 'var(--domain-finops)' },
    { icon: Gauge, label: t('genie.cost.billedDbus'), value: dbu(billedDbus), color: 'var(--domain-genie)' },
    { icon: Gift, label: t('genie.cost.freeDbus'), value: dbu(freeDbus), color: 'var(--domain-usage)' },
    { icon: Users, label: t('genie.cost.activeUsers'), value: String(activeUsers), color: 'var(--foreground)' },
  ];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">{t('genie.cost.title')}</h2>
        <SourceBadge source={summaryQ.source} />
      </div>
      <p className="text-xs text-muted-foreground">{t('genie.cost.windowNote').replace('{d}', String(windowDays))}</p>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="compass-enter rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <k.icon className="h-4 w-4" style={{ color: k.color }} /> {k.label}
            </div>
            <p className="tnum mt-1 text-xl font-semibold text-card-foreground">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Cost by surface — the split billing.usage lights up (Genie Code vs Agents). */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-card-foreground">{t('genie.cost.bySurface')}</h3>
          <p className="mb-3 text-[11px] text-muted-foreground">{t('genie.cost.surfaceNote')}</p>
          <div className="space-y-2">
            {surfaces.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
            {surfaces.map((x) => (
              <div key={x.surface}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-card-foreground">{toStr(x.surface)}</span>
                  <span className="tnum text-muted-foreground">{usd(toNum(x.list_cost))} · {dbu(toNum(x.dbus))} DBUs</span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${Math.round((toNum(x.dbus) / maxDbus) * 100)}%`, background: 'var(--domain-genie)' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Daily billed-cost trend */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-card-foreground">{t('genie.cost.trend')}</h3>
          {trend.length === 0 ? (
            <p className="text-xs text-muted-foreground">—</p>
          ) : (
            <div className="flex h-24 items-end gap-1">
              {trend.map((x) => (
                <div
                  key={x.usage_date}
                  className="flex-1 rounded-t"
                  title={`${toStr(x.usage_date)}: ${usd(toNum(x.list_cost))}`}
                  style={{ height: `${Math.max(4, Math.round((toNum(x.list_cost) / maxTrend) * 100))}%`, background: 'var(--domain-finops)' }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Free vs billed per user */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-card-foreground">{t('genie.cost.perUser')}</h3>
        <p className="mb-3 text-[11px] text-muted-foreground">{t('genie.cost.perUserNote')}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">{t('genie.cost.colUser')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('genie.cost.colSurface')}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t('genie.cost.colFree')}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t('genie.cost.colPaid')}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t('genie.cost.colCost')}</th>
                <th className="py-1.5 font-medium">{t('genie.cost.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {usersQ.rows.length === 0 && (
                <tr><td colSpan={6} className="py-2 text-muted-foreground">—</td></tr>
              )}
              {usersQ.rows.map((r, i) => {
                const over = toBool(r.over_allowance);
                const limit = toNum(r.free_allowance_limit);
                return (
                  <tr key={`${toStr(r.run_as_user)}-${i}`} className="border-t border-border/60">
                    <td className="py-1.5 pr-3 text-card-foreground">{toStr(r.run_as_user)}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{toStr(r.genie_surface)}</td>
                    <td className="tnum py-1.5 pr-3 text-right text-muted-foreground">{dbu(toNum(r.free_dbus))}{limit > 0 ? ` / ${limit}` : ''}</td>
                    <td className="tnum py-1.5 pr-3 text-right text-muted-foreground">{dbu(toNum(r.paid_dbus))}</td>
                    <td className="tnum py-1.5 pr-3 text-right text-card-foreground">{usd(toNum(r.billed_cost_usd))}</td>
                    <td className="py-1.5">
                      {over ? (
                        <span className="inline-flex items-center gap-1" style={{ color: 'var(--sev-medium)' }}>
                          <AlertTriangle className="h-3.5 w-3.5" /> {t('genie.cost.overAllowance')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1" style={{ color: 'var(--domain-finops)' }}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> {t('genie.cost.withinFree')}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function Genie() {
  const t = useT();
  const { data, loading } = useApi<GenieResp>('/api/genie', {});

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <h1 className="text-xl font-semibold text-foreground">{t('nav.genie')}</h1>

      {loading && <p className="text-sm text-muted-foreground">…</p>}

      {!loading && data.available === false && (
        <NotAvailable title={t('genie.naTitle')} reason={data.reason || t('genie.naReason')} />
      )}

      {!loading && data.available && (
        <>
          <p className="text-sm text-muted-foreground">
            {t('genie.discovered')}: <span className="tnum font-semibold text-foreground">{data.total}</span> · {t('genie.sampled')} {data.sampled}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(data.spaces || []).map((s) => (
              <div key={s.space_id} className="compass-enter rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--domain-genie)' }} />
                  <span className="text-sm font-semibold text-card-foreground">{s.title}</span>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  {s.has_description ? (
                    <span className="inline-flex items-center gap-1" style={{ color: 'var(--domain-finops)' }}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> {t('genie.hasDesc')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1" style={{ color: 'var(--sev-medium)' }}>
                      <AlertTriangle className="h-3.5 w-3.5" /> {t('genie.noDesc')}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{t('genie.tables')}: {s.tables}{s.warehouse ? ` · wh ${s.warehouse.slice(0, 8)}` : ''}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Cost & Consumption — sourced from system.billing.usage (GENIE). */}
      <CostConsumption />

      <FindingsList domain="genie" />
    </div>
  );
}
