import { useMemo, useState } from 'react';
import { ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { normFinding, normScore, type FindingRow } from '../lib/model';
import { useT } from '../lib/i18n';
import { scoreColorVar, SEVERITY_VAR } from '../lib/domains';
import { SeverityBadge } from '../components/SeverityBadge';
import { FindingDrawer } from '../components/FindingDrawer';
import { TeachButton } from '../components/TeachButton';
import type { Severity } from '../lib/api';

const SEVS: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const SEV_ORDER: Record<Severity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

export function Security() {
  const t = useT();
  const { ws } = useWorkspace();
  const findingsQ = useLiveRows('findings', '/api/rows/findings', ws);
  const scoresQ = useLiveRows('scores', '/api/rows/scores', ws);

  const secFindings = useMemo(
    () =>
      findingsQ.rows
        .map(normFinding)
        .filter((f) => f.domain === 'security')
        .sort((a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity]),
    [findingsQ.rows]
  );
  const secScore = useMemo(
    () => scoresQ.rows.map(normScore).find((s) => s.domain === 'security'),
    [scoresQ.rows]
  );

  const [selected, setSelected] = useState<FindingRow | null>(null);

  const bySeverity = SEVS.map((s) => ({
    sev: s,
    count: secFindings.filter((f) => f.severity === s).length,
  }));

  const score = secScore?.score ?? 0;
  const source = findingsQ.source;

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t('nav.security')}</h1>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{
            color: source === 'live' ? 'var(--domain-finops)' : 'var(--sev-medium)',
            background: `color-mix(in oklch, var(${source === 'live' ? '--domain-finops' : '--sev-medium'}) 16%, transparent)`,
          }}
        >
          {source === 'live' ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {source === 'live' ? t('meta.live') : t('meta.demoMode')}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-card-foreground">{t('security.posture')}</h2>
          <div className="flex items-center gap-4">
            <span className="grid h-16 w-16 place-items-center rounded-2xl" style={{ background: `color-mix(in oklch, var(${scoreColorVar(score)}) 18%, transparent)`, color: `var(${scoreColorVar(score)})` }}>
              <ShieldCheck className="h-8 w-8" />
            </span>
            <div>
              <div className="tnum text-3xl font-semibold" style={{ color: `var(${scoreColorVar(score)})` }}>
                {score || '—'}
              </div>
              <div className="text-xs text-muted-foreground">{t('security.score')} / 100</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-card-foreground">{t('security.bySeverity')}</h2>
          <div className="space-y-2">
            {bySeverity.map(({ sev, count }) => {
              const max = Math.max(1, ...bySeverity.map((b) => b.count));
              return (
                <div key={sev} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-xs capitalize text-muted-foreground">{sev}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(100 * count) / max}%`, background: `var(${SEVERITY_VAR[sev]})`, transition: 'width var(--dur-slow) var(--ease)' }}
                    />
                  </div>
                  <span className="tnum w-8 text-right text-sm text-card-foreground">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('security.openFindings')}</h2>
        <ul className="space-y-2">
          {secFindings.length === 0 && <li className="text-sm text-muted-foreground">{t('findings.none')}</li>}
          {secFindings.map((f) => (
            <li
              key={f.id}
              onClick={() => setSelected(f)}
              className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-border/60 p-3 transition-colors hover:bg-accent/50"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="tnum rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{f.ruleId}</span>
                  {f.selfCheck && <span className="text-[10px] uppercase text-muted-foreground">{t('findings.selfCheck')}</span>}
                </div>
                <p className="mt-1 text-sm text-card-foreground">{f.title}</p>
                <p className="truncate text-xs text-muted-foreground">{f.resource}</p>
                <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                  <TeachButton ctx={{ domain: f.domain, ruleId: f.ruleId, title: f.title, remediation: f.remediation, resource: f.resource }} />
                </div>
              </div>
              <SeverityBadge severity={f.severity} />
            </li>
          ))}
        </ul>
      </section>

      <FindingDrawer finding={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
