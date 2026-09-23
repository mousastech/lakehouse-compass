export interface Bubble {
  label: string;
  x: number; // e.g. query count
  y: number; // e.g. avg latency ms
}

// Utilization Scatter (spec §20.3): x = activity, y = latency, bubble size = x.
export function Scatter({ bubbles, xLabel, yLabel }: { bubbles: Bubble[]; xLabel: string; yLabel: string }) {
  const W = 900;
  const H = 340;
  const pad = 48;
  if (bubbles.length === 0) return <div className="grid place-items-center p-8 text-sm text-muted-foreground">—</div>;
  const maxX = Math.max(...bubbles.map((b) => b.x), 1);
  const maxY = Math.max(...bubbles.map((b) => b.y), 1);
  const px = (x: number) => pad + (x / maxX) * (W - pad * 1.5);
  const py = (y: number) => H - pad - (y / maxY) * (H - pad * 1.5);
  const r = (x: number) => 6 + Math.sqrt(x / maxX) * 26;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Utilization scatter">
      <line x1={pad} y1={H - pad} x2={W - pad / 2} y2={H - pad} stroke="var(--border)" />
      <line x1={pad} y1={pad / 2} x2={pad} y2={H - pad} stroke="var(--border)" />
      <text x={W / 2} y={H - 8} textAnchor="middle" style={{ fill: 'var(--muted-foreground)', fontSize: 11 }}>{xLabel}</text>
      <text x={14} y={H / 2} textAnchor="middle" transform={`rotate(-90 14 ${H / 2})`} style={{ fill: 'var(--muted-foreground)', fontSize: 11 }}>{yLabel}</text>
      {bubbles.map((b, i) => (
        <g key={i} className="compass-enter">
          <circle cx={px(b.x)} cy={py(b.y)} r={r(b.x)} fill="color-mix(in oklch, var(--domain-performance) 45%, transparent)" stroke="var(--domain-performance)">
            <title>{`${b.label}: ${b.x} · ${Math.round(b.y)} ms`}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}
