import { useMemo, useState } from 'react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { normCompliance } from '../lib/model';
import { useT } from '../lib/i18n';
import { SourceBadge } from '../components/SourceBadge';

const STATUS_COLOR: Record<string, string> = {
  MET: '--domain-finops',
  PARTIAL: '--sev-medium',
  NOT_MET: '--sev-critical',
  MANUAL: '--domain-governance',
  NOT_MEASURABLE: '--sev-info',
};

export function Compliance() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows, source } = useLiveRows('compliance', '/api/rows/compliance', ws);
  const controls = useMemo(() => rows.map(normCompliance), [rows]);
  const frameworks = useMemo(() => [...new Set(controls.map((c) => c.framework))].filter(Boolean), [controls]);
  const [fw, setFw] = useState<string>('');
  const active = fw || frameworks[0] || '';
  const fwControls = controls.filter((c) => c.framework === active);
  const met = fwControls.filter((c) => c.status === 'MET').length;

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t('nav.compliance')}</h1>
        <SourceBadge source={source} />
      </div>

      <div className="flex flex-wrap gap-2">
        {frameworks.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFw(f)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              f === active ? 'border-[var(--primary)] text-foreground' : 'border-border text-muted-foreground hover:bg-accent'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        {fwControls.length > 0 && (
          <>
            <span className="tnum font-semibold text-foreground">{met}</span> / {fwControls.length} {t('compliance.met')}
          </>
        )}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fwControls.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
        {fwControls.map((c) => {
          const color = `var(${STATUS_COLOR[c.status] ?? '--sev-info'})`;
          return (
            <div key={c.controlId} className="compass-enter rounded-xl border border-border bg-card p-3" style={{ borderLeft: `3px solid ${color}` }}>
              <div className="flex items-center justify-between gap-2">
                <span className="tnum text-[11px] font-medium text-muted-foreground">{c.controlId}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase" style={{ color, background: `color-mix(in oklch, ${color} 15%, transparent)` }}>
                  {c.status}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-card-foreground">{c.title}</p>
              <p className="text-[11px] text-muted-foreground">{c.category}</p>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t('meta.advisory')}</p>
    </div>
  );
}
