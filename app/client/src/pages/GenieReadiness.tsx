import { useMemo } from 'react';
import { CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { useT } from '../lib/i18n';
import { toNum, toStr, toBool } from '../lib/rows';
import { scoreColorVar } from '../lib/domains';
import { HealthRing } from '../components/HealthRing';
import { Radar, type RadarAxis } from '../components/Radar';
import { SourceBadge, NotAvailable } from '../components/SourceBadge';
import { FindingsList } from '../components/FindingsList';

interface Signal { label: string; value: number | string; unit?: string; detail?: string }
interface Pillar {
  key: string; name: string; weight: number; score: number; level: number; levelLabel: string;
  available: boolean; unavailableReason: string; signals: Signal[]; gaps: string[];
}
interface TopGap { pillar: string; gap: string }

function parseArr<T>(v: unknown): T[] {
  // Live mode: the analytics plugin auto-parses valid-JSON string columns, so the
  // value may already be an array. Demo/fixture mode: it's a JSON string. Handle both.
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? (p as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

// Compact axis labels for the radar (full names are long).
const SHORT: Record<string, string> = {
  uc_foundation: 'UC',
  metadata: 'Metadata',
  relationships: 'Modeling',
  metrics: 'Metrics',
  genie_agents: 'Agents',
  domains: 'Domains',
  adoption: 'Adoption',
};
const PILLAR_ORDER = ['uc_foundation', 'metadata', 'relationships', 'metrics', 'genie_agents', 'domains', 'adoption'];

export function GenieReadiness() {
  const t = useT();
  const { ws } = useWorkspace();
  const summary = useLiveRows('genie_readiness', '/api/rows/genie_readiness', ws);
  const pillarsQ = useLiveRows('genie_readiness_pillars', '/api/rows/genie_readiness_pillars', ws);

  const s = summary.rows[0] ?? {};
  const overall = toNum(s.overall_score);
  const levelLabel = toStr(s.level_label);
  const stage = toStr(s.readiness_stage);
  const guidance = toStr(s.guidance);
  const topGaps = useMemo(() => parseArr<TopGap>(s.top_gaps_json), [s.top_gaps_json]);

  const pillars = useMemo<Pillar[]>(() => {
    const mapped = pillarsQ.rows.map((r) => ({
      key: toStr(r.pillar_key),
      name: toStr(r.name),
      weight: toNum(r.weight),
      score: toNum(r.score),
      level: toNum(r.level),
      levelLabel: toStr(r.level_label),
      available: toBool(r.available),
      unavailableReason: toStr(r.unavailable_reason),
      signals: parseArr<Signal>(r.signals_json),
      gaps: parseArr<string>(r.gaps_json),
    }));
    return mapped.sort((a, b) => PILLAR_ORDER.indexOf(a.key) - PILLAR_ORDER.indexOf(b.key));
  }, [pillarsQ.rows]);

  const axes: RadarAxis[] = useMemo(
    () => pillars.map((p) => ({ label: SHORT[p.key] ?? p.name, value: Math.round(p.score), available: p.available })),
    [pillars]
  );

  const source = summary.source === 'loading' ? pillarsQ.source : summary.source;
  const hasData = pillars.length > 0;
  const assessedCount = pillars.filter((p) => p.available).length;

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t('nav.genie_readiness')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('genieready.subtitle')}</p>
        </div>
        <SourceBadge source={source} />
      </div>

      {!hasData && !pillarsQ.loading && (
        <NotAvailable title={t('genieready.naTitle')} reason={t('genieready.naReason')} />
      )}

      {hasData && (
        <>
          {/* Overall score + stage + guidance */}
          <section className="rounded-2xl border border-border bg-card p-6">
            <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-center lg:gap-10">
              <HealthRing
                score={Math.round(overall)}
                delta={0}
                coveragePct={Math.round((pillars.filter((p) => p.available).length / (pillars.length || 1)) * 100)}
                label={t('genieready.overall')}
                deltaLabel=""
                coverageLabel={t('genieready.assessed')}
              />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                    style={{ color: `var(${scoreColorVar(overall)})`, background: `color-mix(in oklch, var(${scoreColorVar(overall)}) 15%, transparent)` }}
                  >
                    <Sparkles className="h-3.5 w-3.5" /> {stage}
                  </span>
                  <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                    {t('genieready.maturity')}: <span className="font-semibold text-foreground">{levelLabel}</span>
                  </span>
                  <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{assessedCount} / {pillars.length}</span> {t('genieready.assessed')}
                  </span>
                </div>
                <p className="text-sm text-foreground">{guidance}</p>
                <p className="text-xs text-muted-foreground">{t('genieready.note')}</p>
              </div>
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Radar */}
            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="mb-2 text-sm font-semibold text-card-foreground">{t('genieready.radar')}</h2>
              <Radar axes={axes} overall={overall} />
            </section>

            {/* Top gaps */}
            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('genieready.topGaps')}</h2>
              <ul className="space-y-2">
                {topGaps.length === 0 && <li className="text-sm text-muted-foreground">{t('genieready.noGaps')}</li>}
                {topGaps.map((g, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-lg border border-border/60 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--sev-medium)' }} />
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g.pillar}</div>
                      <p className="text-sm text-card-foreground">{g.gap}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* Pillar cards */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-card-foreground">{t('genieready.pillars')}</h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {pillars.map((p) => (
                <div key={p.key} className="compass-enter flex flex-col rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-card-foreground">{p.name}</span>
                    <span className="tnum text-lg font-semibold" style={{ color: `var(${scoreColorVar(p.score)})` }}>
                      {p.available ? Math.round(p.score) : '—'}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5">{t('genieready.weight')} {p.weight}</span>
                    {p.available && (
                      <span className="inline-flex items-center gap-1">
                        {p.level >= 3 ? (
                          <CheckCircle2 className="h-3 w-3" style={{ color: 'var(--domain-finops)' }} />
                        ) : (
                          <AlertTriangle className="h-3 w-3" style={{ color: 'var(--sev-medium)' }} />
                        )}
                        {p.levelLabel}
                      </span>
                    )}
                  </div>

                  {/* progress bar */}
                  {p.available && (
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.round(p.score))}%`, background: `var(${scoreColorVar(p.score)})`, transition: 'width var(--dur-slow) var(--ease)' }} />
                    </div>
                  )}

                  {!p.available && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      <span className="font-semibold" style={{ color: 'var(--sev-medium)' }}>{t('genieready.notAvailable')}</span>
                      {p.unavailableReason ? ` · ${p.unavailableReason}` : ''}
                    </p>
                  )}

                  {p.available && p.signals.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {p.signals.map((sig, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-muted-foreground" title={sig.detail}>{sig.label}</span>
                          <span className="tnum shrink-0 font-medium text-foreground">
                            {toStr(sig.value)}{sig.unit ? sig.unit : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {p.gaps.length > 0 && (
                    <ul className="mt-3 space-y-1 border-t border-border/60 pt-2">
                      {p.gaps.map((g, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" style={{ color: 'var(--sev-high)' }} />
                          <span>{g}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <FindingsList domain="genie_readiness" />
    </div>
  );
}
