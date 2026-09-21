import { Wifi, WifiOff } from 'lucide-react';
import { useT } from '../lib/i18n';

export function SourceBadge({ source }: { source: 'live' | 'demo' | 'loading' }) {
  const t = useT();
  const live = source === 'live';
  const varName = live ? '--domain-finops' : '--sev-medium';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ color: `var(${varName})`, background: `color-mix(in oklch, var(${varName}) 16%, transparent)` }}
    >
      {live ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      {live ? t('meta.live') : t('meta.demoMode')}
    </span>
  );
}

export function NotAvailable({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="compass-enter grid place-items-center rounded-2xl border border-dashed border-border bg-card/40 p-12 text-center">
      <span
        className="mb-3 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--sev-medium)', background: 'color-mix(in oklch, var(--sev-medium) 15%, transparent)' }}
      >
        NOT AVAILABLE
      </span>
      <p className="max-w-md text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{reason}</p>
    </div>
  );
}
