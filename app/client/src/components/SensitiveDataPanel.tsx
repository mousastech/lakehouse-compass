import { useMemo, useState } from 'react';
import { useLiveRows } from '../lib/analytics';
import { toBool, toNum, toStr } from '../lib/rows';
import { useT } from '../lib/i18n';

const PROTECTION_VAR: Record<string, string> = {
  direct_mask: '--domain-finops',
  abac_policy: '--domain-finops',
  none: '--sev-high',
};

/**
 * Sensitive data × protection (Security screen). Tagged / detected columns are
 * checked against direct column masks and visible ABAC column-mask policies;
 * name-based candidates are listed separately and labelled as a heuristic.
 */
export function SensitiveDataPanel({ ws }: { ws: string }) {
  const t = useT();
  const metrics = useLiveRows('governance_metrics', '/api/rows/governance_metrics', ws);
  const cols = useLiveRows('sensitive_columns', '/api/rows/sensitive_columns', ws);
  const coverage = useLiveRows('classification_coverage', '/api/rows/classification_coverage', ws);
  const [showHeuristic, setShowHeuristic] = useState(false);

  const m = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of metrics.rows) map[toStr(r.metric)] = toNum(r.value);
    return map;
  }, [metrics.rows]);

  const rows = useMemo(
    () =>
      cols.rows.map((r) => ({
        fq: `${toStr(r.catalog)}.${toStr(r.schema)}.${toStr(r.table)}.${toStr(r.column)}`,
        source: toStr(r.source),
        tag: toStr(r.tag_key),
        protection: toStr(r.protection),
        by: toStr(r.protected_by),
      })),
    [cols.rows]
  );
  const sensitive = rows.filter((r) => r.source !== 'name_heuristic');
  const heuristic = rows.filter((r) => r.source === 'name_heuristic');
  const catalogs = coverage.rows.map((r) => ({ name: toStr(r.catalog), enabled: r.enabled == null ? null : toBool(r.enabled) }));

  if (!('protection_sensitive_columns' in m)) return null;

  const kpis = [
    { key: 'sensitive', value: m.protection_sensitive_columns, color: undefined },
    { key: 'directMask', value: m.protection_direct_mask, color: '--domain-finops' },
    { key: 'abac', value: m.protection_abac, color: '--domain-finops' },
    { key: 'unprotected', value: m.protection_unprotected, color: m.protection_unprotected > 0 ? '--sev-high' : undefined },
  ];

  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <h2 className="text-sm font-semibold text-card-foreground">{t('prot.title')}</h2>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">{t('prot.help')}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.key} className="rounded-xl border border-border/60 p-3">
            <div className="tnum text-2xl font-semibold" style={{ color: k.color ? `var(${k.color})` : undefined }}>{k.value}</div>
            <div className="text-[11px] text-muted-foreground">{t(`prot.kpi.${k.key}`)}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
        <span>{t('prot.masksTotal')}: <span className="tnum">{m.protection_masks_total ?? 0}</span></span>
        <span>{t('prot.abacVisible')}: <span className="tnum">{m.protection_abac_visible ?? 0}</span></span>
        <span>
          {t('prot.detections')}: {m.protection_detections_readable ? t('prot.readable') : t('prot.notReadable')}
        </span>
      </div>
      {!m.protection_detections_readable && (
        <p className="mt-2 text-xs text-muted-foreground">{t('prot.detectionsGrant')}</p>
      )}

      {catalogs.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-xs font-medium text-card-foreground">{t('prot.classification')}</div>
          <div className="flex flex-wrap gap-2">
            {catalogs.map((c) => {
              const v = c.enabled ? '--domain-finops' : '--sev-medium';
              return (
                <span key={c.name} className="rounded-full px-2.5 py-1 font-mono text-[11px]" style={{ color: `var(${v})`, background: `color-mix(in oklch, var(${v}) 14%, transparent)` }}>
                  {c.name} · {c.enabled == null ? '—' : c.enabled ? t('prot.enabled') : t('prot.notEnabled')}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {sensitive.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t('prot.col.column')}</th>
                <th className="px-3 py-2 font-medium">{t('prot.col.source')}</th>
                <th className="px-3 py-2 font-medium">{t('prot.col.tag')}</th>
                <th className="px-3 py-2 font-medium">{t('prot.col.protection')}</th>
              </tr>
            </thead>
            <tbody>
              {sensitive.slice(0, 50).map((r) => (
                <tr key={r.fq} className="border-b border-border/50">
                  <td className="px-3 py-2 font-mono text-xs text-card-foreground">{r.fq}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{t(`prot.source.${r.source}`)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.tag}</td>
                  <td className="px-3 py-2 text-xs" style={{ color: `var(${PROTECTION_VAR[r.protection] ?? '--sev-medium'})` }} title={r.by}>
                    {t(`prot.protection.${r.protection}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {heuristic.length > 0 && (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setShowHeuristic((s) => !s)}
            aria-expanded={showHeuristic}
            className="text-xs font-medium text-card-foreground underline-offset-2 hover:underline"
          >
            {t('prot.heuristicTitle')} ({m.protection_name_candidates ?? heuristic.length}) {showHeuristic ? '▾' : '▸'}
          </button>
          <p className="mt-1 text-xs text-muted-foreground">{t('prot.heuristicHelp')}</p>
          {showHeuristic && (
            <ul className="mt-2 max-h-72 divide-y divide-border/50 overflow-y-auto rounded-lg border border-border/60">
              {heuristic.slice(0, 200).map((r) => (
                <li key={r.fq} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
                  <span className="truncate font-mono text-card-foreground" title={r.fq}>{r.fq}</span>
                  <span className="shrink-0 text-muted-foreground">{r.tag}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
