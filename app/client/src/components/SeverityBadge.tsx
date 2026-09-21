import { SEVERITY_VAR } from '../lib/domains';
import type { Severity } from '../lib/api';

const ICON: Record<Severity, string> = {
  critical: '●',
  high: '▲',
  medium: '◆',
  low: '■',
  info: '·',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const color = `var(${SEVERITY_VAR[severity]})`;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide"
      style={{
        color,
        background: `color-mix(in oklch, ${color} 16%, transparent)`,
      }}
    >
      <span aria-hidden>{ICON[severity]}</span>
      {severity}
    </span>
  );
}
