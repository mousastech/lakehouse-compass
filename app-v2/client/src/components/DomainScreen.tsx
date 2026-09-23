import { useState } from 'react';
import { GitPullRequestArrow, Check, Loader2 } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { useT } from '../lib/i18n';
import { normScore, normFinding, type FindingRow } from '../lib/model';
import type { DomainId } from '../lib/api';
import { scoreColorVar, DOMAIN_META } from '../lib/domains';
import { SeverityBadge } from './SeverityBadge';
import { SourceBadge } from './SourceBadge';
import { TeachButton } from './TeachButton';

// Plain-language status band for the "Norte" (question 1).
function statusKey(score: number): string {
  if (score >= 85) return 'v2.status.healthy';
  if (score >= 70) return 'v2.status.mostly';
  if (score >= 55) return 'v2.status.attention';
  return 'v2.status.urgent';
}

function DraftButton({ findingId, ws }: { findingId: string; ws: string }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const draft = async () => {
    setState('loading');
    try {
      const r = await fetch('/api/agent/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finding_id: findingId, ws }),
      });
      setState(r.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  };
  return (
    <button
      type="button"
      onClick={draft}
      disabled={state === 'loading' || state === 'done'}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-60"
    >
      {state === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === 'done' ? <Check className="h-3.5 w-3.5" style={{ color: 'var(--domain-finops)' }} /> : <GitPullRequestArrow className="h-3.5 w-3.5" />}
      {state === 'done' ? t('v2.draft.done') : t('v2.draft.button')}
    </button>
  );
}

export function DomainScreen({ domain }: { domain: DomainId }) {
  const t = useT();
  const { ws } = useWorkspace();
  const scoresQ = useLiveRows('scores', '/api/rows/scores', ws);
  const findingsQ = useLiveRows('findings', '/api/rows/findings', ws);

  const score = scoresQ.rows.map(normScore).find((s) => s.domain === domain && !s.isOverall);
  const all = findingsQ.rows.map(normFinding).filter((f) => f.domain === domain && f.status === 'open');
  const top = all.slice(0, 3);
  const rest = all.length - top.length;
  const s = score?.score ?? 0;
  const domainLabel = t(DOMAIN_META[domain]?.tKey ?? domain);

  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{domainLabel}</h1>
        <SourceBadge source={scoresQ.source} />
      </div>

      {/* 1 · NORTE — score + plain-language status */}
      <section className="compass-enter flex items-center gap-5 rounded-2xl border border-border bg-card p-5">
        <div
          className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-2xl font-bold"
          style={{ color: `var(${scoreColorVar(s)})`, background: `color-mix(in oklch, var(${scoreColorVar(s)}) 14%, transparent)` }}
        >
          {Math.round(s)}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('v2.norte')}</p>
          <p className="mt-0.5 text-base font-medium text-card-foreground">
            {t(statusKey(s)).replace('{n}', String(all.length)).replace('{d}', domainLabel)}
          </p>
        </div>
      </section>

      {/* 2 · WHAT TO DO NOW — top-3 prioritized */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t('v2.todo')}</h2>
        {top.length === 0 && (
          <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">{t('v2.allClear')}</p>
        )}
        {top.map((f: FindingRow) => (
          <div key={f.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={f.severity} />
              <span className="tnum rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{f.ruleId}</span>
              <span className="text-sm font-medium text-card-foreground">{f.title}</span>
            </div>
            {/* 3 · WHY IT MATTERS — plain language */}
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {f.remediation || t('v2.whyFallback')}
            </p>
            {f.resource && <p className="mt-1 text-[11px] text-muted-foreground/80">{f.resource}</p>}
            {/* 4 · ONE-CLICK — draft + teach */}
            <div className="mt-3 flex flex-wrap items-start gap-2">
              <DraftButton findingId={f.id} ws={ws} />
              <TeachButton ctx={{ domain: f.domain, ruleId: f.ruleId, title: f.title, remediation: f.remediation, resource: f.resource }} />
            </div>
          </div>
        ))}
        {rest > 0 && <p className="text-xs text-muted-foreground">{t('v2.more').replace('{n}', String(rest))}</p>}
      </section>
    </div>
  );
}
