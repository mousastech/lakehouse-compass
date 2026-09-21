import { NavLink } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { DOMAIN_META, DOMAIN_PATH, scoreColorVar } from '../lib/domains';
import { useT } from '../lib/i18n';
import type { DomainScore } from '../lib/api';

export function DomainCard({ d, index }: { d: DomainScore; index: number }) {
  const t = useT();
  const meta = DOMAIN_META[d.id];
  const domainColor = `var(${meta.colorVar})`;
  const scoreColor = `var(${scoreColorVar(d.score)})`;

  return (
    <NavLink
      to={DOMAIN_PATH[d.id]}
      className="compass-enter group rounded-xl border border-border bg-card p-4 transition-colors hover:border-[var(--primary)]"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: domainColor }} />
          <span className="text-sm font-medium text-card-foreground">{t(meta.tKey)}</span>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <div className="mt-3 flex items-end justify-between">
        <span className="tnum text-2xl font-semibold" style={{ color: scoreColor }}>
          {d.score}
        </span>
        <span className="text-[11px] text-muted-foreground">weight {d.weight}</span>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{
            width: `${d.score}%`,
            background: scoreColor,
            transition: 'width var(--dur-slow) var(--ease)',
          }}
        />
      </div>

      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="tnum">
          {d.findings} {t('overview.findings')}
        </span>
        {d.criticalFindings > 0 && (
          <span className="tnum" style={{ color: 'var(--sev-critical)' }}>
            {d.criticalFindings} {t('overview.critical')}
          </span>
        )}
      </div>
    </NavLink>
  );
}
