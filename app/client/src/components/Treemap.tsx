import { fmtUsd } from '../lib/format';

export interface TreemapItem {
  label: string;
  value: number;
  colorVar: string;
  detail?: string;
}

interface Rect extends TreemapItem {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Slice-and-dice layout: proportional strips along the longer axis. Sorted desc
// so large tiles land first, keeping aspect ratios reasonable without a lib.
function layout(items: TreemapItem[], W: number, H: number): Rect[] {
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, i) => s + i.value, 0) || 1;
  const rects: Rect[] = [];
  let x = 0,
    y = 0,
    w = W,
    h = H,
    remaining = total;
  for (const item of sorted) {
    const frac = item.value / remaining;
    if (w >= h) {
      const rw = w * frac;
      rects.push({ ...item, x, y, w: rw, h });
      x += rw;
      w -= rw;
    } else {
      const rh = h * frac;
      rects.push({ ...item, x, y, w, h: rh });
      y += rh;
      h -= rh;
    }
    remaining -= item.value;
  }
  return rects;
}

export function Treemap({
  items,
  height = 260,
  onSelect,
  selected,
}: {
  items: TreemapItem[];
  height?: number;
  onSelect?: (label: string) => void;
  selected?: string;
}) {
  const W = 1000;
  const rects = layout(items, W, height);
  if (rects.length === 0) {
    return <div className="grid place-items-center p-8 text-sm text-muted-foreground">—</div>;
  }
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-label="Cost treemap" preserveAspectRatio="none">
      {rects.map((r) => {
        const showLabel = r.w > 90 && r.h > 34;
        const isSelected = selected === r.label;
        const dim = selected != null && selected !== '' && !isSelected;
        return (
          <g
            key={r.label}
            className="compass-enter"
            onClick={onSelect ? () => onSelect(isSelected ? '' : r.label) : undefined}
            style={onSelect ? { cursor: 'pointer' } : undefined}
          >
            <rect
              x={r.x + 1}
              y={r.y + 1}
              width={Math.max(0, r.w - 2)}
              height={Math.max(0, r.h - 2)}
              rx={6}
              fill={`color-mix(in oklch, var(${r.colorVar}) 55%, var(--card))`}
              stroke={isSelected ? 'var(--primary)' : 'var(--border)'}
              strokeWidth={isSelected ? 2.5 : 1}
              opacity={dim ? 0.45 : 1}
            >
              <title>{`${r.label}: ${fmtUsd(r.value)}${r.detail ? ` · ${r.detail}` : ''}${onSelect ? ' · click to drill down' : ''}`}</title>
            </rect>
            {showLabel && (
              <>
                <text x={r.x + 10} y={r.y + 20} style={{ fill: 'var(--foreground)', fontSize: 13, fontWeight: 600 }}>
                  {r.label}
                </text>
                <text x={r.x + 10} y={r.y + 37} className="tnum" style={{ fill: 'var(--muted-foreground)', fontSize: 12 }}>
                  {fmtUsd(r.value)}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
