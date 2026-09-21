import type { ComponentType } from 'react';
import { Construction } from 'lucide-react';
import { useT } from '../lib/i18n';

interface Props {
  titleKey: string;
  icon?: ComponentType<{ className?: string }>;
  phase?: string;
}

export function Stub({ titleKey, icon: Icon = Construction, phase = 'Phase 1' }: Props) {
  const t = useT();
  return (
    <div className="mx-auto max-w-[1200px]">
      <h1 className="text-xl font-semibold text-foreground">{t(titleKey)}</h1>
      <div className="compass-enter mt-6 grid place-items-center rounded-2xl border border-dashed border-border bg-card/40 p-12 text-center">
        <span
          className="mb-4 grid h-14 w-14 place-items-center rounded-2xl"
          style={{
            background: 'color-mix(in oklch, var(--primary) 16%, transparent)',
            color: 'var(--primary)',
          }}
        >
          <Icon className="h-7 w-7" />
        </span>
        <span
          className="mb-2 rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide"
          style={{
            color: 'var(--primary)',
            background: 'color-mix(in oklch, var(--primary) 14%, transparent)',
          }}
        >
          {phase}
        </span>
        <p className="max-w-md text-sm font-medium text-foreground">{t('stub.comingSoon')}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('stub.phase0')}</p>
      </div>
    </div>
  );
}
