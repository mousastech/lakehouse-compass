export interface TrendPoint {
  label: string; // date
  score: number; // 0-100
  coverage: number; // 0-100
}

// Two 0–100 series (score + coverage) over time, oldest→newest left→right.
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const W = 900;
  const H = 220;
  const pad = 34;
  if (points.length === 0) return <div className="grid place-items-center p-8 text-sm text-muted-foreground">—</div>;
  const n = points.length;
  const x = (i: number) => pad + (n === 1 ? (W - pad * 2) / 2 : (i / (n - 1)) * (W - pad * 2));
  const y = (v: number) => H - pad - (v / 100) * (H - pad * 1.5);
  const path = (key: 'score' | 'coverage') =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Score and coverage trend">
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1={pad} y1={y(g)} x2={W - pad} y2={y(g)} stroke="var(--border)" strokeDasharray="2 4" />
          <text x={pad - 6} y={y(g) + 3} textAnchor="end" style={{ fill: 'var(--muted-foreground)', fontSize: 9 }}>{g}</text>
        </g>
      ))}
      <path d={path('coverage')} fill="none" stroke="var(--primary)" strokeWidth={2} opacity={0.6} strokeDasharray="4 3" />
      <path d={path('score')} fill="none" stroke="var(--domain-finops)" strokeWidth={2.5} />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.score)} r={3} fill="var(--domain-finops)">
          <title>{`${p.label}: score ${p.score}, coverage ${p.coverage}%`}</title>
        </circle>
      ))}
      <g>
        <rect x={W - 210} y={8} width={10} height={3} fill="var(--domain-finops)" />
        <text x={W - 196} y={13} style={{ fill: 'var(--muted-foreground)', fontSize: 10 }}>score</text>
        <rect x={W - 140} y={8} width={10} height={3} fill="var(--primary)" />
        <text x={W - 126} y={13} style={{ fill: 'var(--muted-foreground)', fontSize: 10 }}>coverage</text>
      </g>
    </svg>
  );
}
