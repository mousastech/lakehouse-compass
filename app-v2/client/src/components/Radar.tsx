import { scoreColorVar } from '../lib/domains';

export interface RadarAxis {
  label: string; // short pillar name
  value: number; // 0-100
  available?: boolean; // false => pillar was NOT measured (distinct from a real 0)
}

// A 7-axis (or N-axis) radar/scorecard of pillar scores, rendered as inline SVG
// in the style of TrendChart/Scatter (no charting dependency). Grid rings at
// 25/50/75/100; the polygon is filled with the overall-score accent color.
export function Radar({ axes, overall }: { axes: RadarAxis[]; overall: number }) {
  const W = 460;
  const H = 380;
  const cx = W / 2;
  const cy = H / 2 + 6;
  const R = 128;
  const n = axes.length;
  if (n === 0) return <div className="grid place-items-center p-8 text-sm text-muted-foreground">—</div>;

  const accent = `var(${scoreColorVar(overall)})`;
  // A pillar with no readable source is "not measured" — kept distinct from a
  // real 0-score pillar (undefined `available` is treated as measured).
  const isAvail = (a: RadarAxis) => a.available !== false;
  // Angle for axis i: start at top (-90deg), clockwise.
  const angle = (i: number) => (-Math.PI / 2) + (i / n) * 2 * Math.PI;
  const pt = (i: number, r: number): [number, number] => [
    cx + r * Math.cos(angle(i)),
    cy + r * Math.sin(angle(i)),
  ];

  const rings = [25, 50, 75, 100];
  const ringPath = (pct: number) =>
    axes.map((_, i) => {
      const [x, y] = pt(i, (pct / 100) * R);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ') + ' Z';

  // Value polygon spans only the MEASURED axes; unavailable pillars leave a gap
  // rather than being drawn as a solid 0 vertex.
  const measuredPts = axes
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => isAvail(a))
    .map(({ a, i }) => pt(i, (Math.max(0, Math.min(100, a.value)) / 100) * R));
  const valuePath =
    measuredPts.map(([x, y], k) => `${k === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') +
    (measuredPts.length > 2 ? ' Z' : '');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Readiness by pillar (radar)">
      {/* grid rings */}
      {rings.map((pct) => (
        <path key={pct} d={ringPath(pct)} fill="none" stroke="var(--border)" strokeWidth={1} strokeDasharray={pct === 100 ? undefined : '2 4'} />
      ))}
      {/* spokes — dashed + muted for unavailable pillars */}
      {axes.map((a, i) => {
        const [x, y] = pt(i, R);
        const avail = isAvail(a);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="var(--border)"
            strokeWidth={1}
            strokeDasharray={avail ? undefined : '2 4'}
          />
        );
      })}
      {/* value polygon (measured axes only) */}
      <path d={valuePath} fill={accent} fillOpacity={0.18} stroke={accent} strokeWidth={2} strokeLinejoin="round" />
      {/* value vertices — solid dot when measured; nothing when not */}
      {axes.map((a, i) => {
        if (!isAvail(a)) return null;
        const [x, y] = pt(i, (Math.max(0, Math.min(100, a.value)) / 100) * R);
        return (
          <circle key={i} cx={x} cy={y} r={3.5} fill={accent}>
            <title>{`${a.label}: ${a.value}`}</title>
          </circle>
        );
      })}
      {/* axis labels — value when measured, muted "n/a" when not */}
      {axes.map((a, i) => {
        const [lx, ly] = pt(i, R + 22);
        const anchor = Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end';
        const avail = isAvail(a);
        return (
          <text
            key={i}
            x={lx}
            y={ly}
            textAnchor={anchor}
            dominantBaseline="middle"
            style={{ fill: 'var(--muted-foreground)', fontSize: 11, fontStyle: avail ? undefined : 'italic' }}
          >
            {a.label}
            {avail ? (
              <tspan dx={4} style={{ fill: 'var(--foreground)', fontWeight: 600 }}>{a.value}</tspan>
            ) : (
              <tspan dx={4} style={{ fill: 'var(--muted-foreground)' }}>n/a</tspan>
            )}
          </text>
        );
      })}
    </svg>
  );
}
