export interface Bar {
  label: string;
  value: number;
  color?: string; // CSS var name, e.g. '--primary'
}

/** A dependency-free vertical bar chart (SVG), themed via CSS vars. Used for the
 * Genie Portfolio "activity by top space" and "leverage breakdown" charts. */
export function BarChart({
  bars,
  height = 240,
  yLabel,
  valueFmt = (n) => String(n),
  defaultColor = '--primary',
  rotateLabels,
}: {
  bars: Bar[];
  height?: number;
  yLabel?: string;
  valueFmt?: (n: number) => string;
  defaultColor?: string;
  rotateLabels?: boolean;
}) {
  const W = 520;
  const padL = 40;
  const padR = 12;
  const padT = 16;
  const rotate = rotateLabels ?? bars.length > 5;
  const padB = rotate ? 64 : 30;
  const plotW = W - padL - padR;
  const plotH = height - padT - padB;
  const max = Math.max(...bars.map((b) => b.value), 1);
  const niceMax = max <= 5 ? 5 : Math.ceil(max / 10) * 10;
  const bw = plotW / Math.max(bars.length, 1);
  const barW = Math.min(bw * 0.6, 48);
  const y = (v: number) => padT + plotH - (v / niceMax) * plotH;
  const cx = (i: number) => padL + bw * i + bw / 2;
  const grid = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ maxHeight: height }} role="img">
      {grid.map((g, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={y(niceMax * g)} y2={y(niceMax * g)} style={{ stroke: 'var(--border)' }} strokeWidth={1} />
          <text x={padL - 6} y={y(niceMax * g) + 3} textAnchor="end" style={{ fill: 'var(--muted-foreground)', fontSize: 9 }}>
            {Math.round(niceMax * g)}
          </text>
        </g>
      ))}
      {yLabel && (
        <text x={12} y={padT + plotH / 2} textAnchor="middle" transform={`rotate(-90 12 ${padT + plotH / 2})`}
          style={{ fill: 'var(--muted-foreground)', fontSize: 10 }}>{yLabel}</text>
      )}
      {bars.map((b, i) => {
        const h = Math.max(0, ((b.value / niceMax) * plotH));
        return (
          <g key={b.label + i}>
            <rect x={cx(i) - barW / 2} y={y(b.value)} width={barW} height={h} rx={2}
              style={{ fill: `var(${b.color || defaultColor})` }}>
              <title>{`${b.label}: ${valueFmt(b.value)}`}</title>
            </rect>
            <text
              x={rotate ? cx(i) : cx(i)}
              y={height - padB + (rotate ? 12 : 14)}
              textAnchor={rotate ? 'end' : 'middle'}
              transform={rotate ? `rotate(-32 ${cx(i)} ${height - padB + 12})` : undefined}
              style={{ fill: 'var(--muted-foreground)', fontSize: 9 }}
            >
              {b.label.length > 16 ? b.label.slice(0, 15) + '…' : b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
