import { useMemo, useState } from 'react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { normFinding, type FindingRow } from '../lib/model';
import { useT } from '../lib/i18n';
import { SeverityBadge } from './SeverityBadge';
import { FindingDrawer } from './FindingDrawer';
import { TeachButton } from './TeachButton';
import type { DomainId, Severity } from '../lib/api';

const SEV_ORDER: Record<Severity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

export function FindingsList({ domain }: { domain: DomainId }) {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows } = useLiveRows('findings', '/api/rows/findings', ws);
  const findings = useMemo(
    () => rows.map(normFinding).filter((f) => f.domain === domain).sort((a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity]),
    [rows, domain]
  );
  const [selected, setSelected] = useState<FindingRow | null>(null);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('findings.open')}</h2>
      <ul className="space-y-2">
        {findings.length === 0 && <li className="text-sm text-muted-foreground">{t('findings.none')}</li>}
        {findings.map((f) => (
          <li
            key={f.id}
            onClick={() => setSelected(f)}
            className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-border/60 p-3 transition-colors hover:bg-accent/50"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="tnum rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{f.ruleId}</span>
                {f.selfCheck && <span className="text-[10px] uppercase text-muted-foreground">{t('findings.selfCheck')}</span>}
              </div>
              <p className="mt-1 text-sm text-card-foreground">{f.title}</p>
              <p className="truncate text-xs text-muted-foreground">{f.resource}</p>
              <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                <TeachButton ctx={{ domain: f.domain, ruleId: f.ruleId, title: f.title, remediation: f.remediation, resource: f.resource }} />
              </div>
            </div>
            <SeverityBadge severity={f.severity} />
          </li>
        ))}
      </ul>
      <FindingDrawer finding={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
