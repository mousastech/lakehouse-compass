export interface Series {
  label: string;
  values: number[];
  colorVar: string;
  dashed?: boolean;
}

// Generic multi-series line chart, auto-scaled to the max value (counts, not %).
export function SeriesChart({ labels, series, height = 200 }: { labels: string[]; series: Series[]; height?: number }) {
  const W = 900;
  const pad = 34;
  const n = labels.length;
  if (n === 0) return <div className="grid place-items-center p-8 text-sm text-muted-foreground">—</div>;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => pad + (n === 1 ? (W - pad * 2) / 2 : (i / (n - 1)) * (W - pad * 2));
  const y = (v: number) => height - pad - (v / max) * (height - pad * 1.4);
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-label="Trend">
      {[0, 0.5, 1].map((g) => (
        <g key={g}>
          <line x1={pad} y1={y(max * g)} x2={W - pad} y2={y(max * g)} stroke="var(--border)" strokeDasharray="2 4" />
          <text x={pad - 6} y={y(max * g) + 3} textAnchor="end" style={{ fill: 'var(--muted-foreground)', fontSize: 9 }}>{Math.round(max * g)}</text>
        </g>
      ))}
      {series.map((s) => (
        <g key={s.label}>
          <path d={path(s.values)} fill="none" stroke={`var(${s.colorVar})`} strokeWidth={2.5} strokeDasharray={s.dashed ? '4 3' : undefined} />
          {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={`var(${s.colorVar})`} />)}
        </g>
      ))}
      {labels.map((l, i) => (
        <text key={i} x={x(i)} y={height - 8} textAnchor="middle" style={{ fill: 'var(--muted-foreground)', fontSize: 8 }}>{l.slice(5)}</text>
      ))}
      <g>
        {series.map((s, i) => (
          <g key={s.label}>
            <rect x={W - 260 + i * 130} y={6} width={10} height={3} fill={`var(${s.colorVar})`} />
            <text x={W - 246 + i * 130} y={11} style={{ fill: 'var(--muted-foreground)', fontSize: 10 }}>{s.label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
