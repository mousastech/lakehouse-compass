import { useMemo, useState } from 'react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { toBool, toNum, toStr } from '../lib/rows';
import { useT } from '../lib/i18n';
import { scoreColorVar } from '../lib/domains';
import { SourceBadge } from '../components/SourceBadge';
import { FindingsList } from '../components/FindingsList';
import { MetadataReadinessCard } from '../components/MetadataReadinessCard';
import { DescriptionReviewPanel } from '../components/DescriptionReviewPanel';

const WEAK_CLASSES = ['generic', 'echo', 'placeholder', 'short', 'boilerplate'] as const;
const ROLES = ['domain', 'layer', 'owner'] as const;
type Role = (typeof ROLES)[number];

interface WeakExample { class: string; text: string; n: number; names: number }
interface Drift {
  key_variants?: { keys: string[]; in_use?: string[]; governed?: string[] }[];
  roles_multi_key?: { role: string; keys: string[] }[];
  value_variants?: { role: string; values: string[] }[];
}
interface InvalidValues { key: string; assignments: number; values: string[]; allowed: string[] }

function pct(n: number, d: number): number {
  return d ? Math.round((1000 * n) / d) / 10 : 0;
}

// AppKit already parses JSON-looking string columns; fixtures send raw strings.
function parseJson<T>(v: unknown, fallback: T): T {
  if (v != null && typeof v === 'object') return v as T;
  try {
    return (JSON.parse(toStr(v)) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Useful / weak / missing as one stacked bar (weak = commented but says nothing). */
function QualityBar({ useful, weak, missing }: { useful: number; weak: number; missing: number }) {
  const total = useful + weak + missing;
  const seg = (n: number, color: string, key: string) =>
    n > 0 ? <div key={key} className="h-full" style={{ width: `${(100 * n) / total}%`, background: color }} /> : null;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
      {total > 0 && [
        seg(useful, 'var(--domain-finops)', 'u'),
        seg(weak, 'var(--sev-medium)', 'w'),
        seg(missing, 'color-mix(in oklch, var(--muted-foreground) 30%, transparent)', 'm'),
      ]}
    </div>
  );
}

export function Governance() {
  const t = useT();
  const { ws } = useWorkspace();
  const metrics = useLiveRows('governance_metrics', '/api/rows/governance_metrics', ws);
  const rollup = useLiveRows('tag_rollup', '/api/rows/tag_rollup', ws);
  const inventory = useLiveRows('tag_inventory', '/api/rows/tag_inventory', ws);
  const [role, setRole] = useState<Role>('domain');

  const m = useMemo(() => {
    const map: Record<string, { value: number; detail: string; raw: unknown }> = {};
    for (const r of metrics.rows) map[toStr(r.metric)] = { value: toNum(r.value), detail: toStr(r.detail), raw: r.detail };
    return map;
  }, [metrics.rows]);
  const v = (k: string) => m[k]?.value ?? 0;

  const coverage = v('comment_coverage_pct');
  const total = v('tables_total');
  const undoc = v('tables_undocumented');
  const scope = m['comment_coverage_pct']?.detail ?? '';

  const hasQuality = 'column_total' in m;
  const quality = (['column', 'table'] as const).map((s) => {
    const useful = v(`${s}_q_useful`);
    const missing = v(`${s}_q_missing`);
    const weak = WEAK_CLASSES.reduce((acc, q) => acc + v(`${s}_q_${q}`), 0);
    return { scope: s, useful, weak, missing, total: v(`${s}_total`), documentedPct: v(`${s}_documented_pct`), usefulPct: v(`${s}_useful_pct`) };
  });
  const weakByClass = WEAK_CLASSES.map((q) => ({ q, n: v(`column_q_${q}`) })).filter((x) => x.n > 0);
  const examples = parseJson<WeakExample[]>(m['weak_comment_examples']?.raw, []);
  const hasHygiene = 'tag_drift' in m;
  const drift = parseJson<Drift>(m['tag_drift']?.raw, {});
  const invalid = parseJson<InvalidValues[]>(m['tag_invalid_values']?.raw, []);
  const governedPct = v('tag_assignments_governed_pct');

  const rollupRows = useMemo(
    () =>
      rollup.rows
        .filter((r) => toStr(r.role) === role)
        .map((r) => ({
          value: toStr(r.value),
          tables: toNum(r.tables),
          columns: toNum(r.columns),
          columnsUseful: toNum(r.columns_useful),
          certified: toNum(r.certified),
          withOwner: toNum(r.with_owner),
          gold: toNum(r.gold),
        }))
        // tagged values by size, the untagged bucket last
        .sort((a, b) => (a.value === '') !== (b.value === '') ? (a.value === '' ? 1 : -1) : b.tables - a.tables),
    [rollup.rows, role]
  );

  const tags = useMemo(
    () =>
      inventory.rows.map((r) => ({
        key: toStr(r.tag_key),
        role: toStr(r.role),
        suggested: toStr(r.suggested_role),
        governed: r.governed == null ? null : toBool(r.governed),
        where: toStr(r.securable_types),
        assignments: toNum(r.assignments),
        invalid: toNum(r.invalid_assignments),
        top: parseJson<{ v: string; n: number }[]>(r.top_values_json, []),
      })),
    [inventory.rows]
  );

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t('nav.governance')}</h1>
        <SourceBadge source={metrics.source} />
      </div>

      <MetadataReadinessCard metrics={m} ws={ws} />

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-card-foreground">{t('gov.semanticReadiness')}</h2>
        <div className="flex flex-wrap items-center gap-8">
          <div>
            <div className="tnum text-4xl font-semibold" style={{ color: `var(${scoreColorVar(coverage)})` }}>
              {coverage}%
            </div>
            <div className="text-xs text-muted-foreground">{t('gov.commentCoverage')}{scope ? ` · ${scope}` : ''}</div>
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

      {hasQuality && (
        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold text-card-foreground">{t('gov.quality.title')}</h2>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">{t('gov.quality.help')}</p>
          <div className="grid gap-6 md:grid-cols-2">
            {quality.map((q) => (
              <div key={q.scope}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-card-foreground">{t(`gov.quality.${q.scope}s`)}</span>
                  <span className="text-xs text-muted-foreground">
                    <span className="tnum font-semibold" style={{ color: `var(${scoreColorVar(q.usefulPct)})` }}>{q.usefulPct}%</span>{' '}
                    {t('gov.quality.useful')} · <span className="tnum">{q.documentedPct}%</span> {t('gov.quality.documented')}
                  </span>
                </div>
                <QualityBar useful={q.useful} weak={q.weak} missing={q.missing} />
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: 'var(--domain-finops)' }} />{t('gov.quality.useful')} <span className="tnum">{q.useful}</span></span>
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: 'var(--sev-medium)' }} />{t('gov.quality.weak')} <span className="tnum">{q.weak}</span></span>
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-muted-foreground/30" />{t('gov.quality.missing')} <span className="tnum">{q.missing}</span></span>
                </div>
              </div>
            ))}
          </div>

          {weakByClass.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {weakByClass.map(({ q, n }) => (
                <span key={q} title={t(`gov.q.${q}.help`)} className="rounded-full px-2.5 py-1 text-[11px]" style={{ color: 'var(--sev-medium)', background: 'color-mix(in oklch, var(--sev-medium) 14%, transparent)' }}>
                  {t(`gov.q.${q}`)} · <span className="tnum">{n}</span>
                </span>
              ))}
            </div>
          )}

          {examples.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-xs font-medium text-card-foreground">{t('gov.quality.examples')}</div>
              <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
                {examples.slice(0, 8).map((e, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <span className="truncate font-mono text-card-foreground" title={e.text}>“{e.text}”</span>
                    <span className="shrink-0 text-muted-foreground">
                      {t(`gov.q.${e.class}`)} · <span className="tnum">{e.n}</span> {t('gov.quality.columns')} · <span className="tnum">{e.names}</span> {t('gov.quality.names')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <DescriptionReviewPanel ws={ws} />

      {rollup.rows.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <div>
              <div className="text-sm font-semibold text-card-foreground">{t('gov.scorecard.title')}</div>
              <p className="text-xs text-muted-foreground">{t('gov.scorecard.help')}</p>
            </div>
            <div role="tablist" aria-label={t('gov.scorecard.title')} className="inline-flex rounded-lg border border-border p-0.5">
              {ROLES.map((r) => (
                <button
                  key={r}
                  role="tab"
                  aria-selected={role === r}
                  onClick={() => setRole(r)}
                  className={`rounded-md px-3 py-1 text-xs transition-colors ${role === r ? 'bg-primary/15 font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {t(`gov.role.${r}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto p-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t(`gov.role.${role}`)}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('gov.col.tables')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('gov.col.usefulCols')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('gov.col.certified')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('gov.col.withOwner')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('gov.col.gold')}</th>
                </tr>
              </thead>
              <tbody>
                {rollupRows.map((r) => {
                  const useful = pct(r.columnsUseful, r.columns);
                  const untagged = r.value === '';
                  return (
                    <tr key={r.value || '__untagged'} className="border-b border-border/50">
                      <td className={`px-3 py-2 ${untagged ? 'italic text-muted-foreground' : 'text-card-foreground'}`}>
                        {untagged ? t('gov.untagged') : r.value}
                      </td>
                      <td className="tnum px-3 py-2 text-right text-muted-foreground">{r.tables}</td>
                      <td className="tnum px-3 py-2 text-right" style={{ color: `var(${scoreColorVar(useful)})` }}>{useful}%</td>
                      <td className="tnum px-3 py-2 text-right text-muted-foreground">{r.certified}</td>
                      <td className="tnum px-3 py-2 text-right" style={{ color: r.withOwner === 0 && !untagged ? 'var(--sev-medium)' : undefined }}>{r.withOwner}</td>
                      <td className="tnum px-3 py-2 text-right text-muted-foreground">{r.gold}</td>
                    </tr>
                  );
                })}
                {rollupRows.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('gov.scorecard.none')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hasHygiene && (
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-card-foreground">{t('gov.hygiene.title')}</h2>
            <span className="text-xs text-muted-foreground">
              <span className="tnum font-semibold text-card-foreground">{governedPct}%</span> {t('gov.hygiene.governedShare')}
            </span>
          </div>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">{t('gov.hygiene.help')}</p>
          <div className="grid gap-5 md:grid-cols-3">
            <div>
              <div className="mb-1.5 text-xs font-medium text-card-foreground">{t('gov.hygiene.keyVariants')}</div>
              {(drift.key_variants ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('gov.hygiene.none')}</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {(drift.key_variants ?? []).map((g) => (
                    <li key={g.keys.join('|')} className="font-mono text-card-foreground">
                      {g.keys.map((k) => (
                        <span key={k} className="mr-1.5" title={(g.governed ?? []).includes(k) ? t('gov.tags.yes') : t('gov.tags.no')}>
                          {k}{(g.governed ?? []).includes(k) ? '' : '*'}
                        </span>
                      ))}
                    </li>
                  ))}
                  <li className="text-[11px] text-muted-foreground">{t('gov.hygiene.ungovernedMark')}</li>
                </ul>
              )}
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-card-foreground">{t('gov.hygiene.rolesMultiKey')}</div>
              {(drift.roles_multi_key ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('gov.hygiene.none')}</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {(drift.roles_multi_key ?? []).map((g) => (
                    <li key={g.role}>
                      <span className="text-muted-foreground">{t(`gov.role.${g.role}`)}:</span>{' '}
                      <span className="font-mono text-card-foreground">{g.keys.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              )}
              {(drift.value_variants ?? []).length > 0 && (
                <ul className="mt-2 space-y-1 text-xs">
                  {(drift.value_variants ?? []).map((g) => (
                    <li key={`${g.role}:${g.values.join('|')}`}>
                      <span className="text-muted-foreground">{t('gov.hygiene.valueVariants')} ({t(`gov.role.${g.role}`)}):</span>{' '}
                      <span className="font-mono text-card-foreground">{g.values.join(' / ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-card-foreground">{t('gov.hygiene.invalid')}</div>
              {invalid.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('gov.hygiene.none')}</p>
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {invalid.map((i) => (
                    <li key={i.key}>
                      <span className="font-mono text-card-foreground">{i.key}</span>{' '}
                      <span style={{ color: 'var(--sev-medium)' }}>{i.values.join(', ')}</span>{' '}
                      <span className="text-muted-foreground">· <span className="tnum">{i.assignments}</span> · {t('gov.hygiene.allowed')}: {i.allowed.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {tags.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5">
            <div className="text-sm font-semibold text-card-foreground">{t('gov.tags.title')}</div>
            <p className="text-xs text-muted-foreground">{t('gov.tags.help')}</p>
          </div>
          <div className="overflow-x-auto p-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t('gov.col.key')}</th>
                  <th className="px-3 py-2 font-medium">{t('gov.col.role')}</th>
                  <th className="px-3 py-2 font-medium">{t('gov.col.governed')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('gov.col.assignments')}</th>
                  <th className="px-3 py-2 font-medium">{t('gov.col.where')}</th>
                  <th className="px-3 py-2 font-medium">{t('gov.col.topValues')}</th>
                </tr>
              </thead>
              <tbody>
                {tags.map((g) => (
                  <tr key={g.key} className="border-b border-border/50 align-top">
                    <td className="px-3 py-2 font-mono text-xs text-card-foreground">{g.key}</td>
                    <td className="px-3 py-2 text-xs">
                      {g.role ? (
                        <span className="rounded-full px-2 py-0.5" style={{ color: 'var(--domain-finops)', background: 'color-mix(in oklch, var(--domain-finops) 15%, transparent)' }}>
                          {t(`gov.role.${g.role}`)}
                        </span>
                      ) : g.suggested ? (
                        <span title={t('gov.tags.suggestHelp')} className="rounded-full border border-dashed border-border px-2 py-0.5 text-muted-foreground">
                          {t('gov.tags.suggested')}: {t(`gov.role.${g.suggested}`)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {g.governed == null ? '—' : g.governed ? t('gov.tags.yes') : t('gov.tags.no')}
                      {g.invalid > 0 && (
                        <span className="ml-1" style={{ color: 'var(--sev-medium)' }}>
                          · <span className="tnum">{g.invalid}</span> {t('gov.tags.invalid')}
                        </span>
                      )}
                    </td>
                    <td className="tnum px-3 py-2 text-right text-muted-foreground">{g.assignments}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{g.where.split(',').map((w) => t(`gov.securable.${w}`)).join(', ')}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {g.top.map((x) => `${x.v} (${x.n})`).join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <FindingsList domain="governance" />
    </div>
  );
}
