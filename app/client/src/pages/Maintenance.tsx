import { useMemo } from 'react';
import { CalendarClock } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { useApi } from '../lib/api';
import { normFinding } from '../lib/model';
import { toStr } from '../lib/rows';
import { useT } from '../lib/i18n';
import { fmtDate, daysUntil } from '../lib/format';

export function Maintenance() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows } = useLiveRows('findings', '/api/rows/findings', ws);
  const { data: tasks } = useApi<Record<string, unknown>[]>('/api/rows/maintenance', []);

  const mntFindings = useMemo(
    () => rows.map(normFinding).filter((f) => f.ruleId.startsWith('MNT')),
    [rows]
  );

  return (
    <div className="mx-auto max-w-[1000px] space-y-4">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-5 w-5" style={{ color: 'var(--primary)' }} />
        <h1 className="text-xl font-semibold text-foreground">{t('nav.maintenance')}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{t('maint.subtitle')}</p>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('maint.thisWeek')}</h2>
        <ul className="space-y-2">
          {tasks.length === 0 && mntFindings.length === 0 && <li className="text-sm text-muted-foreground">—</li>}
          {tasks.map((mtask) => {
            const due = daysUntil(String(mtask.dueAt));
            const overdue = mtask.status === 'overdue' || due < 0;
            return (
              <li key={String(mtask.id)} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="tnum rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{toStr(mtask.sourceRule)}</span>
                    <span className="text-xs text-muted-foreground">{toStr(mtask.owner)}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-card-foreground">{toStr(mtask.resource)}</p>
                </div>
                <span
                  className="tnum shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    color: overdue ? 'var(--sev-critical)' : 'var(--sev-medium)',
                    background: `color-mix(in oklch, var(${overdue ? '--sev-critical' : '--sev-medium'}) 16%, transparent)`,
                  }}
                >
                  {overdue ? t('overview.overdue') : fmtDate(String(mtask.dueAt))}
                </span>
              </li>
            );
          })}
          {mntFindings.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
              <div className="min-w-0">
                <span className="tnum rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{f.ruleId}</span>
                <p className="mt-1 truncate text-sm text-card-foreground">{f.title}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-xs text-muted-foreground">{t('maint.note')}</p>
    </div>
  );
}
