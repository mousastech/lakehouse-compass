import { useMemo, useState } from 'react';
import { Megaphone, ArrowDownRight, ArrowUpRight, Minus, Wrench, ShieldAlert, Check } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useApi, type Severity } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { firstRow, toNum } from '../lib/rows';
import { useT } from '../lib/i18n';
import { scoreColorVar } from '../lib/domains';
import { SourceBadge } from '../components/SourceBadge';
import { SeverityBadge } from '../components/SeverityBadge';
import { KpiCard } from '../components/KpiCard';

interface PlanItem {
  rank: number;
  finding_id: string;
  rule_id: string;
  severity: string;
  title: string;
  resource: string;
  weakest_pillar: string;
  weakest_pillar_score: number | null;
  rationale: string;
  remediation: string;
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string' || !v.trim()) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export function Digest() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows, source } = useLiveRows('digests', '/api/rows/digests', ws);
  const d = useMemo(() => firstRow(rows), [rows]);
  const { data: plan } = useApi<PlanItem[]>(`/api/agent/plan?ws=${encodeURIComponent(ws || '')}`, []);

  const score = toNum(d.score);
  const delta = d.score_delta === null || d.score_delta === undefined ? null : toNum(d.score_delta);
  const weakest = parseJson<{ pillar: string; score: number; findings: number }[]>(d.weakest_pillars_json, []);
  const limited = parseJson<string[]>(d.limited_pillars_json, []);
  const newIds = parseJson<string[]>(d.new_json, []);
  const resolvedIds = parseJson<string[]>(d.resolved_json, []);
  const stillOpen = parseJson<string[]>(d.still_open_json, []);

  const [drafted, setDrafted] = useState<Record<string, string>>({});
  const [drafting, setDrafting] = useState<string | null>(null);

  async function draft(findingId: string) {
    setDrafting(findingId);
    try {
      const r = await fetch('/api/agent/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finding_id: findingId, ws }),
      });
      const j = (await r.json()) as { change_id?: string };
      if (j.change_id) setDrafted((m) => ({ ...m, [findingId]: j.change_id as string }));
    } catch {
      /* ignore — keep button actionable */
    } finally {
      setDrafting(null);
    }
  }

  const DeltaIcon = delta === null ? Minus : delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
  const deltaColor = delta === null || delta === 0 ? '--muted-foreground' : delta > 0 ? '--domain-finops' : '--sev-high';
  const hasDigest = Object.keys(d).length > 0;

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Megaphone className="h-5 w-5" style={{ color: 'var(--primary)' }} />
          <div>
            <h1 className="text-xl font-semibold text-foreground">{t('digest.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('digest.subtitle')}</p>
          </div>
        </div>
        <SourceBadge source={source} />
      </div>

      {hasDigest && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KpiCard
            label={t('digest.score')}
            value={score}
            accentVar={scoreColorVar(score)}
            sub={delta === null ? t('digest.firstScan') : `${delta > 0 ? '+' : ''}${delta} ${t('digest.sinceLast')}`}
            icon={<DeltaIcon className="h-4 w-4" style={{ color: `var(${deltaColor})` }} />}
          />
          <KpiCard label={t('digest.coverage')} value={`${toNum(d.coverage_pct)}%`} accentVar="--domain-usage" />
          <KpiCard label={t('digest.criticalOpen')} value={toNum(d.crit)} accentVar="--sev-critical" icon={<ShieldAlert className="h-4 w-4" />} />
          <KpiCard label={t('digest.highOpen')} value={toNum(d.high)} accentVar="--sev-high" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Weakest pillars */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('digest.weakest')}</h2>
          {weakest.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('digest.none')}</p>
          ) : (
            <div className="space-y-2.5">
              {weakest.map((p) => (
                <div key={p.pillar}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-card-foreground">{t(`waf.pillar.${p.pillar}`)}</span>
                    <span className="tabular-nums" style={{ color: `var(${scoreColorVar(p.score)})` }}>{p.score}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div style={{ width: `${Math.max(0, Math.min(100, p.score))}%`, background: `var(${scoreColorVar(p.score)})`, height: '100%' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {limited.length > 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              {t('digest.limited')}: {limited.map((p) => t(`waf.pillar.${p}`)).join(', ')}.
            </p>
          )}
        </section>

        {/* What changed */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('digest.changes')}</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted/50 p-2">
              <div className="text-lg font-semibold tabular-nums" style={{ color: 'var(--sev-high)' }}>{newIds.length}</div>
              <div className="text-[11px] text-muted-foreground">{t('digest.new')}</div>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <div className="text-lg font-semibold tabular-nums" style={{ color: 'var(--domain-finops)' }}>{resolvedIds.length}</div>
              <div className="text-[11px] text-muted-foreground">{t('digest.resolved')}</div>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <div className="text-lg font-semibold tabular-nums text-card-foreground">{stillOpen.length}</div>
              <div className="text-[11px] text-muted-foreground">{t('digest.stillOpen')}</div>
            </div>
          </div>
          {newIds.length > 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              {t('digest.new')}: {newIds.slice(0, 10).join(', ')}{newIds.length > 10 ? '…' : ''}
            </p>
          )}
        </section>
      </div>

      {/* Prioritized remediation plan (advisor triage) */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-1 flex items-center gap-2">
          <Wrench className="h-4 w-4" style={{ color: 'var(--primary)' }} />
          <h2 className="text-sm font-semibold text-card-foreground">{t('digest.plan')}</h2>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t('digest.planNote')}</p>
        {plan.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('digest.planNone')}</p>
        ) : (
          <div className="space-y-2">
            {plan.slice(0, 12).map((item) => (
              <div key={item.finding_id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-card-foreground">
                  {item.rank}
                </span>
                <SeverityBadge severity={item.severity as Severity} />
                <div className="min-w-[200px] flex-1">
                  <div className="text-sm text-card-foreground">
                    <span className="font-mono text-xs text-muted-foreground">{item.rule_id}</span> · {item.title}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{item.resource} — {item.rationale}</div>
                </div>
                {drafted[item.finding_id] ? (
                  <a
                    href="/changes"
                    className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium"
                    style={{ color: 'var(--domain-finops)' }}
                  >
                    <Check className="h-3.5 w-3.5" /> {t('digest.drafted')}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => draft(item.finding_id)}
                    disabled={drafting === item.finding_id}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
                  >
                    <Wrench className="h-3.5 w-3.5" /> {drafting === item.finding_id ? t('digest.drafting') : t('digest.draft')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">{t('digest.advisory')}</p>
    </div>
  );
}
