import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accentVar?: string;
  icon?: ReactNode;
}

export function KpiCard({ label, value, sub, accentVar = '--primary', icon }: Props) {
  return (
    <div className="compass-enter rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {icon && <span style={{ color: `var(${accentVar})` }}>{icon}</span>}
      </div>
      <div className="tnum mt-2 text-2xl font-semibold text-card-foreground">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      <div
        className="mt-3 h-1 w-full rounded-full"
        style={{ background: `color-mix(in oklch, var(${accentVar}) 40%, transparent)` }}
      />
    </div>
  );
}
