export interface Segment {
  label: string;
  value: number;
  colorVar: string; // e.g. '--domain-finops'
}

/** A single horizontal stacked bar with a legend — used for the Genie Cost
 * "today's cost split" (free user usage vs billable service-principal usage). */
export function StackedBar({ segments, unit = '$', height = 28 }: { segments: Segment[]; unit?: string; height?: number }) {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  const pct = (v: number) => (total > 0 ? (100 * Math.max(0, v)) / total : 0);
  const fmt = (v: number) => `${unit}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: `var(${s.colorVar})` }} />
            {s.label} · <span className="tnum text-foreground">{fmt(s.value)}</span>
          </span>
        ))}
      </div>
      <div className="flex w-full overflow-hidden rounded-md" style={{ height }}>
        {total === 0 ? (
          <div className="grid w-full place-items-center bg-muted text-[11px] text-muted-foreground">—</div>
        ) : (
          segments.map((s) => (
            <div key={s.label} style={{ width: `${pct(s.value)}%`, background: `var(${s.colorVar})` }} title={`${s.label}: ${fmt(s.value)}`} />
          ))
        )}
      </div>
    </div>
  );
}
