import { useMemo } from 'react';
import { useLiveRows } from '../lib/analytics';
import { toNum, toStr } from '../lib/rows';
import { useT } from '../lib/i18n';
import { scoreColorVar } from '../lib/domains';

const COMPONENTS = ['documentation', 'sensitivity', 'ownership', 'curation'] as const;

/** Usage-weighted Metadata Readiness (P6): index, its four components and the per-domain split. */
export function MetadataReadinessCard({ metrics, ws }: { metrics: Record<string, { value: number; detail: string }>; ws: string }) {
  const t = useT();
  const domains = useLiveRows('metadata_readiness_domains', '/api/rows/metadata_readiness_domains', ws);

  const rows = useMemo(
    () =>
      domains.rows.map((r) => ({
        domain: toStr(r.domain),
        tables: toNum(r.tables),
        index: toNum(r.index),
        ...Object.fromEntries(COMPONENTS.map((c) => [c, toNum(r[c])])),
      })) as ({ domain: string; tables: number; index: number } & Record<(typeof COMPONENTS)[number], number>)[],
    [domains.rows]
  );

  if (!('metadata_readiness' in metrics)) return null;
  const index = metrics.metadata_readiness.value;
  const unweighted = metrics.metadata_readiness_unweighted?.value ?? 0;

  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <h2 className="text-sm font-semibold text-card-foreground">{t('mr.title')}</h2>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">{t('mr.help')}</p>
      <div className="flex flex-wrap items-center gap-8">
        <div>
          <div className="tnum text-4xl font-semibold" style={{ color: `var(${scoreColorVar(index)})` }}>{index}</div>
          <div className="text-xs text-muted-foreground">
            {t('mr.weighted')} · {t('mr.unweighted')} <span className="tnum">{unweighted}</span>
          </div>
        </div>
        <div className="grid min-w-[260px] flex-1 gap-2">
          {COMPONENTS.map((c) => {
            const v = metrics[`mr_${c}`]?.value ?? 0;
            const w = Math.round(Number(metrics[`mr_${c}`]?.detail || 0) * 100);
            return (
              <div key={c} className="flex items-center gap-3">
                <span className="w-36 shrink-0 text-xs text-muted-foreground" title={t(`mr.c.${c}.help`)}>
                  {t(`mr.c.${c}`)} <span className="tnum opacity-70">· {w}%</span>
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${v}%`, background: `var(${scoreColorVar(v)})`, transition: 'width var(--dur-slow) var(--ease)' }} />
                </div>
                <span className="tnum w-10 text-right text-xs text-card-foreground">{v}</span>
              </div>
            );
          })}
        </div>
      </div>
      {metrics.metadata_readiness.detail && (
        <p className="mt-3 text-[11px] text-muted-foreground">{metrics.metadata_readiness.detail}</p>
      )}

      {rows.length > 1 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t('gov.role.domain')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('gov.col.tables')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('mr.index')}</th>
                {COMPONENTS.map((c) => (
                  <th key={c} className="px-3 py-2 text-right font-medium">{t(`mr.c.${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.domain || '__none'} className="border-b border-border/50">
                  <td className={`px-3 py-2 ${r.domain ? 'text-card-foreground' : 'italic text-muted-foreground'}`}>{r.domain || t('gov.untagged')}</td>
                  <td className="tnum px-3 py-2 text-right text-muted-foreground">{r.tables}</td>
                  <td className="tnum px-3 py-2 text-right font-medium" style={{ color: `var(${scoreColorVar(r.index)})` }}>{r.index}</td>
                  {COMPONENTS.map((c) => (
                    <td key={c} className="tnum px-3 py-2 text-right text-muted-foreground">{r[c]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
