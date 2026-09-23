import { Compass } from 'lucide-react';
import { useT } from '../lib/i18n';

export function BrandMark({ collapsed = false }: { collapsed?: boolean }) {
  const t = useT();
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
        style={{
          background: 'color-mix(in oklch, var(--primary) 22%, transparent)',
          color: 'var(--primary)',
        }}
      >
        <Compass className="h-5 w-5" />
      </span>
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold text-sidebar-foreground">
            {t('app.name')}
          </div>
          <div className="truncate text-[11px] text-sidebar-foreground/55">{t('app.tagline')}</div>
        </div>
      )}
    </div>
  );
}
