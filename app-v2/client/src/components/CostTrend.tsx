import { useMemo, useState } from 'react';
import { useLiveRows } from '../lib/analytics';
import { useT } from '../lib/i18n';
import { toNum, toStr } from '../lib/rows';
import { SourceBadge } from './SourceBadge';

interface Pt { date: string; cost: number }
type Period = '30d' | '90d' | '6m' | '12m' | 'month';
type Grain = 'month' | 'day';

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PERIODS: { key: Period; label: string }[] = [
  { key: '30d', label: '30d' }, { key: '90d', label: '90d' },
  { key: '6m', label: '6M' }, { key: '12m', label: '12M' },
];

/** Evolutionary total-cost chart: relative-window or specific-month period filter,
 * monthly (default) / daily granularity, from the precomputed cost_trend (daily
 * cost by product, summed across products here). */
export function CostTrend({ ws }: { ws: string }) {
  const t = useT();
  const q = useLiveRows('cost_trend', '/api/rows/cost_trend', ws);
  const [period, setPeriod] = useState<Period>('12m');
  const [grain, setGrain] = useState<Grain>('month');
  const [month, setMonth] = useState<string>('');

  // Daily total, summed by date across products (and workspaces in Account mode).
  const daily = useMemo<Pt[]>(() => {
    const m = new Map<string, number>();
    for (const r of q.rows) {
      const d = toStr(r.usage_date);
      if (!d) continue;
      m.set(d, (m.get(d) || 0) + toNum(r.cost_usd));
    }
    return Array.from(m.entries()).map(([date, cost]) => ({ date, cost })).sort((a, b) => a.date.localeCompare(b.date));
  }, [q.rows]);

  const months = useMemo(() => {
    const s = new Set<string>();
    daily.forEach((p) => s.add(p.date.slice(0, 7)));
    return Array.from(s).sort().reverse();
  }, [daily]);

  const filtered = useMemo<Pt[]>(() => {
    if (daily.length === 0) return [];
    if (period === 'month' && month) return daily.filter((p) => p.date.slice(0, 7) === month);
    const days = period === '30d' ? 30 : period === '90d' ? 90 : period === '6m' ? 182 : 365;
    const last = new Date(daily[daily.length - 1].date);
    last.setUTCDate(last.getUTCDate() - (days - 1));
    const cut = last.toISOString().slice(0, 10);
    return daily.filter((p) => p.date >= cut);
  }, [daily, period, month]);

  const effGrain: Grain = period === 'month' ? 'day' : grain;

  const series = useMemo<Pt[]>(() => {
    if (effGrain === 'day') return filtered;
    const m = new Map<string, number>();
    for (const p of filtered) { const k = p.date.slice(0, 7); m.set(k, (m.get(k) || 0) + p.cost); }
    return Array.from(m.entries()).map(([date, cost]) => ({ date, cost })).sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered, effGrain]);

  const total = series.reduce((a, p) => a + p.cost, 0);
  const max = Math.max(1, ...series.map((p) => p.cost));

  const W = 720, H = 170, PAD_L = 8, PAD_R = 8, PAD_T = 12, PAD_B = 22;
  const iw = W - PAD_L - PAD_R, ih = H - PAD_T - PAD_B;
  const n = series.length;
  const x = (i: number) => PAD_L + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD_T + ih - (v / max) * ih;
  const line = series.map((p, i) => `${x(i).toFixed(1)},${y(p.cost).toFixed(1)}`).join(' ');
  const area = n > 0 ? `${x(0).toFixed(1)},${(PAD_T + ih).toFixed(1)} ${line} ${x(n - 1).toFixed(1)},${(PAD_T + ih).toFixed(1)}` : '';
  const fmtLabel = (d: string) => (effGrain === 'month' ? d : d.slice(5));
  const labelIdx = n <= 6 ? series.map((_, i) => i) : [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-card-foreground">{t('finops.trend.title')}</h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{t('finops.trend.total')}: <span className="tnum font-semibold text-card-foreground">{usd(total)}</span></span>
          <SourceBadge source={q.source} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => { setPeriod(p.key); setMonth(''); }}
              className={`px-2.5 py-1 text-xs ${period === p.key ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground'}`}
            >{p.label}</button>
          ))}
        </div>
        <select
          value={period === 'month' ? month : ''}
          onChange={(e) => { const v = e.target.value; if (v) { setMonth(v); setPeriod('month'); } else { setPeriod('12m'); setMonth(''); } }}
          className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground"
          aria-label={t('genie.cost.pickMonth')}
        >
          <option value="">{t('genie.cost.pickMonth')}</option>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-border">
          {(['month', 'day'] as Grain[]).map((g) => (
            <button
              key={g}
              onClick={() => setGrain(g)}
              disabled={period === 'month'}
              className={`px-2.5 py-1 text-xs disabled:opacity-40 ${effGrain === g ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground'}`}
            >{g === 'month' ? t('genie.cost.grainMonth') : t('genie.cost.grainDay')}</button>
          ))}
        </div>
      </div>

      {series.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">—</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" style={{ height: 190 }} preserveAspectRatio="none" role="img">
          <polygon points={area} fill="var(--domain-finops)" opacity={0.14} />
          <polyline points={line} fill="none" stroke="var(--domain-finops)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          {series.map((p, i) => (
            <circle key={p.date} cx={x(i)} cy={y(p.cost)} r={2.5} fill="var(--domain-finops)">
              <title>{`${p.date}: ${usd(p.cost)}`}</title>
            </circle>
          ))}
          {labelIdx.map((i) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">{fmtLabel(series[i].date)}</text>
          ))}
        </svg>
      )}
    </div>
  );
}
