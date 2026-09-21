import { useMemo, useState } from 'react';
import { Compass, AlertTriangle, CheckCircle2, MinusCircle, ClipboardCheck, ExternalLink } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { asRows, toNum, toStr, toBool } from '../lib/rows';
import { useT } from '../lib/i18n';
import { scoreColorVar } from '../lib/domains';
import { SourceBadge } from '../components/SourceBadge';

// Canonical pillar order. Labels come from i18n (waf.pillar.<slug>).
const PILLARS = [
  'operational_excellence',
  'security',
  'reliability',
  'performance_efficiency',
  'cost_optimization',
  'data_ai_governance',
  'interoperability_usability',
] as const;

// Fallback denominator for scans that predate the Phase-2 control catalogue
// (no controls_total persisted). Live scans use the real catalogue counts.
const TARGET: Record<string, number> = {
  security: 40, data_ai_governance: 25, operational_excellence: 25, cost_optimization: 22,
  reliability: 20, performance_efficiency: 20, interoperability_usability: 15,
};

interface PillarRow {
  pillar: string;
  score: number;
  findings: number;
  critical: number;
  total: number;
  measured: number;
  low: number;
  high: number;
  confidence: 'high' | 'medium' | 'low';
  fromCatalogue: boolean;
}

interface ControlRow {
  pillar: string;
  controlId: string;
  title: string;
  principle: string;
  provenance: string;
  measurability: string;
  severity: string;
  status: string;
  ruleId: string;
  remediation: string;
  docUrl: string;
}

function confidenceOf(frac: number): 'high' | 'medium' | 'low' {
  if (frac >= 0.75) return 'high';
  if (frac >= 0.35) return 'medium';
  return 'low';
}

const STATUS_STYLE: Record<string, { varName: string; icon: typeof CheckCircle2 }> = {
  pass: { varName: '--domain-finops', icon: CheckCircle2 },
  gap: { varName: '--sev-high', icon: AlertTriangle },
  attestation: { varName: '--sev-medium', icon: ClipboardCheck },
  unmeasured: { varName: '--muted-foreground', icon: MinusCircle },
};
const STATUS_ORDER: Record<string, number> = { gap: 0, attestation: 1, unmeasured: 2, pass: 3 };

export function Waf() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows, source } = useLiveRows('waf_scores', '/api/rows/waf_scores', ws);
  const controlsQ = useLiveRows('waf_controls', '/api/rows/waf_controls', ws);
  const [selected, setSelected] = useState<string | null>(null);

  const pillars = useMemo<PillarRow[]>(() => {
    const byId = new Map<string, Record<string, unknown>>();
    for (const r of asRows(rows)) byId.set(toStr(r.pillar), r);
    return PILLARS.map((p) => {
      const r = byId.get(p) ?? {};
      const total = toNum(r.controls_total);
      const measured = toNum(r.controls_measured);
      const passed = toNum(r.controls_passed);
      const fromCatalogue = total > 0;
      if (fromCatalogue) {
        const frac = measured / total;
        const point = measured > 0 ? Math.round((passed / measured) * 1000) / 10 : 0;
        return {
          pillar: p, score: point, findings: toNum(r.findings), critical: toNum(r.critical_findings),
          total, measured, low: toNum(r.low), high: toNum(r.high),
          confidence: confidenceOf(frac), fromCatalogue: true,
        };
      }
      // Fallback: heuristic band from mapped rule count vs TARGET.
      const score = toNum(r.score);
      const rules = toNum(r.rules);
      const tgt = TARGET[p] ?? 20;
      const frac = Math.min(1, tgt > 0 ? rules / tgt : 0);
      return {
        pillar: p, score, findings: toNum(r.findings), critical: toNum(r.critical_findings),
        total: tgt, measured: rules,
        low: Math.round(score * frac * 10) / 10,
        high: Math.round((score * frac + (1 - frac) * 100) * 10) / 10,
        confidence: confidenceOf(frac), fromCatalogue: false,
      };
    }).sort((a, b) => a.low - b.low); // weakest worst-case first
  }, [rows]);

  const controlsByPillar = useMemo(() => {
    const map = new Map<string, ControlRow[]>();
    for (const r of asRows(controlsQ.rows)) {
      const c: ControlRow = {
        pillar: toStr(r.pillar), controlId: toStr(r.control_id), title: toStr(r.title),
        principle: toStr(r.principle), provenance: toStr(r.provenance), measurability: toStr(r.measurability),
        severity: toStr(r.severity), status: toStr(r.status) || (toBool(r.measured) ? 'pass' : 'unmeasured'),
        ruleId: toStr(r.rule_id), remediation: toStr(r.remediation), docUrl: toStr(r.doc_url),
      };
      const arr = map.get(c.pillar) ?? [];
      arr.push(c);
      map.set(c.pillar, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
    return map;
  }, [controlsQ.rows]);

  const fullyMeasured = pillars.filter((p) => p.confidence === 'high').length;
  const selectedControls = selected ? controlsByPillar.get(selected) ?? [] : [];

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Compass className="h-5 w-5" style={{ color: 'var(--primary)' }} />
          <div>
            <h1 className="text-xl font-semibold text-foreground">{t('waf.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('waf.subtitle')}</p>
          </div>
        </div>
        <SourceBadge source={source} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pillars.map((p) => {
          const confVar = p.confidence === 'high' ? '--domain-finops' : p.confidence === 'medium' ? '--sev-medium' : '--sev-high';
          const bandLeft = Math.max(0, Math.min(100, p.low));
          const bandWidth = Math.max(0.5, Math.min(100, p.high) - bandLeft);
          const isSel = selected === p.pillar;
          return (
            <button
              key={p.pillar}
              type="button"
              onClick={() => setSelected(isSel ? null : p.pillar)}
              className={`flex flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-[var(--primary)] ${isSel ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]' : 'border-border'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold text-card-foreground">{t(`waf.pillar.${p.pillar}`)}</h2>
                <span className="shrink-0 rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums" style={{ color: `var(${scoreColorVar(p.score)})` }} title={t('waf.pointNote')}>
                  {p.score}
                </span>
              </div>

              {/* Confidence band: shaded span = worst…best case; tick = point score. */}
              <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted" title={`${t('waf.worstCase')} ${p.low} · ${t('waf.bestCase')} ${p.high}`}>
                <div className="absolute inset-y-0 rounded-full" style={{ left: `${bandLeft}%`, width: `${bandWidth}%`, background: `color-mix(in oklab, var(${scoreColorVar(p.score)}) 55%, transparent)` }} />
                <div className="absolute inset-y-0 w-[2px]" style={{ left: `calc(${Math.max(0, Math.min(100, p.score))}% - 1px)`, background: `var(${scoreColorVar(p.score)})` }} />
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {t('waf.worstCase')} <span className="font-medium text-card-foreground">{p.low}</span>
                  <span className="mx-1">–</span>{p.high} {t('waf.bestCase')}
                </span>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: `var(${confVar})`, background: `color-mix(in oklab, var(${confVar}) 15%, transparent)` }} title={t('waf.confidenceNote')}>
                  {t(`waf.confidence.${p.confidence}`)}
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  <span className="font-medium text-card-foreground tabular-nums">{p.findings}</span> {t('waf.findings')}
                  {p.critical > 0 && <span className="ml-1" style={{ color: 'var(--sev-critical)' }}>· {p.critical} critical</span>}
                </span>
                <span className="tabular-nums">{p.measured} / {p.total} {t('waf.checked')}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Control-catalogue drill-down for the selected pillar. */}
      {selected && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-card-foreground">{t('waf.controlsIn')} {t(`waf.pillar.${selected}`)}</h2>
            <span className="text-xs text-muted-foreground tabular-nums">{selectedControls.length} {t('waf.checked')}</span>
          </div>
          {selectedControls.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('waf.noControls')}</p>
          ) : (
            <ul className="space-y-2">
              {selectedControls.map((c) => {
                const st = STATUS_STYLE[c.status] ?? STATUS_STYLE.unmeasured;
                const Icon = st.icon;
                return (
                  <li key={c.controlId} className="rounded-lg border border-border/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tnum rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{c.controlId}</span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{c.principle}</span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">· {c.provenance}</span>
                        </div>
                        <p className="mt-1 text-sm text-card-foreground">{c.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{c.remediation}</p>
                        {c.docUrl && (
                          <a href={c.docUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs" style={{ color: 'var(--primary)' }}>
                            {t('waf.docs')} <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: `var(${st.varName})`, background: `color-mix(in oklab, var(${st.varName}) 14%, transparent)` }}>
                        <Icon className="h-3.5 w-3.5" /> {t(`waf.status.${c.status}`)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        {t('waf.rangeNote')} · <span className="tabular-nums">{fullyMeasured}/{PILLARS.length}</span> {t('waf.fullyMeasured')}
      </p>
    </div>
  );
}
