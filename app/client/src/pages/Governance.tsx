import { useMemo } from 'react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { toNum, toStr } from '../lib/rows';
import { useT } from '../lib/i18n';
import { scoreColorVar } from '../lib/domains';
import { SourceBadge } from '../components/SourceBadge';
import { FindingsList } from '../components/FindingsList';

export function Governance() {
  const t = useT();
  const { ws } = useWorkspace();
  const metrics = useLiveRows('governance_metrics', '/api/rows/governance_metrics', ws);

  const m = useMemo(() => {
    const map: Record<string, { value: number; detail: string }> = {};
    for (const r of metrics.rows) map[toStr(r.metric)] = { value: toNum(r.value), detail: toStr(r.detail) };
    return map;
  }, [metrics.rows]);

  const coverage = m['comment_coverage_pct']?.value ?? 0;
  const total = m['tables_total']?.value ?? 0;
  const undoc = m['tables_undocumented']?.value ?? 0;
  const catalog = m['comment_coverage_pct']?.detail ?? '';

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t('nav.governance')}</h1>
        <SourceBadge source={metrics.source} />
      </div>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-card-foreground">{t('gov.semanticReadiness')}</h2>
        <div className="flex flex-wrap items-center gap-8">
          <div>
            <div className="tnum text-4xl font-semibold" style={{ color: `var(${scoreColorVar(coverage)})` }}>
              {coverage}%
            </div>
            <div className="text-xs text-muted-foreground">{t('gov.commentCoverage')}{catalog ? ` · ${catalog}` : ''}</div>
          </div>
          <div className="min-w-[220px] flex-1">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>{t('gov.documented')}</span>
              <span className="tnum">{Math.round(total - undoc)} / {total}</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${coverage}%`, background: `var(${scoreColorVar(coverage)})`, transition: 'width var(--dur-slow) var(--ease)' }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t('gov.undocumented')}: <span className="tnum" style={{ color: 'var(--sev-medium)' }}>{undoc}</span></p>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">{t('gov.note')}</p>
      </section>

      <FindingsList domain="governance" />
    </div>
  );
}
