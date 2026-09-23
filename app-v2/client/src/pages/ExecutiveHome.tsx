import { NavLink } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { useT } from '../lib/i18n';
import { toStr } from '../lib/rows';
import { normScore, normFinding } from '../lib/model';
import type { DomainId } from '../lib/api';
import { DOMAIN_META, scoreColorVar } from '../lib/domains';
import { HealthRing } from '../components/HealthRing';
import { SeverityBadge } from '../components/SeverityBadge';
import { SourceBadge } from '../components/SourceBadge';

// v2 ships the domain-contract experience for these three domains; others still
// show in the rollup but only these deep-link to a v2 screen.
const BUILT: DomainId[] = ['finops', 'security', 'performance'];
const PATH: Partial<Record<DomainId, string>> = { finops: '/finops', security: '/security', performance: '/performance' };

export function ExecutiveHome() {
  const t = useT();
  const { ws } = useWorkspace();
  const scoresQ = useLiveRows('scores', '/api/rows/scores', ws);
  const findingsQ = useLiveRows('findings', '/api/rows/findings', ws);
  const trendQ = useLiveRows('trend', '/api/rows/trend', ws);

  const scoreRows = scoresQ.rows.map(normScore);
  const overall = scoreRows.find((s) => s.isOverall);
  const domains = scoreRows.filter((s) => !s.isOverall).sort((a, b) => a.score - b.score); // weakest first
  const attention = findingsQ.rows.map(normFinding).filter((f) => f.status === 'open').slice(0, 8);
  const lastScan = toStr(trendQ.rows[0]?.generated_at).slice(0, 16).replace('T', ' ');

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t('v2.home.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('v2.home.subtitle')}{lastScan ? ` · ${t('meta.lastScan')}: ${lastScan}` : ''}
          </p>
        </div>
        <SourceBadge source={scoresQ.source} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Overall health (the needle) */}
        <div className="compass-enter flex items-center justify-center rounded-2xl border border-border bg-card p-6">
          <HealthRing
            score={overall?.score ?? 0}
            delta={0}
            coveragePct={overall?.coveragePct ?? 0}
            label={t('overview.healthScore')}
            deltaLabel={t('overview.sinceLastScan')}
            coverageLabel={t('overview.coverage')}
          />
        </div>

        {/* Per-domain mini scores (weakest first) */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {domains.map((d) => {
            const path = PATH[d.domain as DomainId];
            const label = t(DOMAIN_META[d.domain as DomainId]?.tKey ?? d.domain);
            const inner = (
              <div className="flex h-full flex-col justify-between rounded-xl border border-border bg-card p-3 hover:bg-accent/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-card-foreground">{label}</span>
                  {path && <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <span className="tnum text-2xl font-bold" style={{ color: `var(${scoreColorVar(d.score)})` }}>{Math.round(d.score)}</span>
                  <span className="text-[11px] text-muted-foreground">{d.findings} {t('overview.findings')}</span>
                </div>
              </div>
            );
            return path ? (
              <NavLink key={d.domain} to={path} className="block">{inner}</NavLink>
            ) : (
              <div key={d.domain}>{inner}</div>
            );
          })}
        </div>
      </div>

      {/* What needs attention now — cross-domain, severity-ranked */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">{t('v2.home.attention')}</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {attention.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t('v2.allClear')}</p>}
          {attention.map((f) => {
            const path = BUILT.includes(f.domain) ? PATH[f.domain] : undefined;
            const label = t(DOMAIN_META[f.domain]?.tKey ?? f.domain);
            const row = (
              <div className="flex items-center gap-3 border-b border-border/50 p-3 last:border-0 hover:bg-accent/30">
                <SeverityBadge severity={f.severity} />
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{label}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-card-foreground">{f.title}</span>
                {path && <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </div>
            );
            return path ? <NavLink key={f.id} to={path} className="block">{row}</NavLink> : <div key={f.id}>{row}</div>;
          })}
        </div>
      </section>
    </div>
  );
}
