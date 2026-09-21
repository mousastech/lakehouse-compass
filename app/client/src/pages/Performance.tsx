import { useMemo } from 'react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { toNum, toStr } from '../lib/rows';
import { useT } from '../lib/i18n';
import { SourceBadge } from '../components/SourceBadge';
import { Scatter, type Bubble } from '../components/Scatter';
import { FindingsList } from '../components/FindingsList';

export function Performance() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows, source } = useLiveRows('perf_summary', '/api/rows/perf_summary', ws);
  const bubbles: Bubble[] = useMemo(
    () => rows.map((r) => ({ label: toStr(r.entity), x: toNum(r.queries), y: toNum(r.avg_ms) })),
    [rows]
  );

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t('nav.performance')}</h1>
        <SourceBadge source={source} />
      </div>
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold text-card-foreground">{t('perf.scatter')}</h2>
        <p className="mb-3 text-xs text-muted-foreground">{t('perf.scatterNote')}</p>
        <Scatter bubbles={bubbles} xLabel={t('perf.queries')} yLabel={t('perf.avgMs')} />
      </section>
      <FindingsList domain="performance" />
    </div>
  );
}
