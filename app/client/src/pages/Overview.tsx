import { useState } from 'react';
import { NavLink } from 'react-router';
import { DollarSign, ShieldCheck, Wrench, Sparkles, ArrowUpRight, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useApi } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { normScore, normFinding, normCost, normCompliance } from '../lib/model';
import { toNum } from '../lib/rows';
import { useT } from '../lib/i18n';
import { fmtUsd, fmtDate, daysUntil } from '../lib/format';
import { HealthRing } from '../components/HealthRing';
import { DomainCard } from '../components/DomainCard';
import { KpiCard } from '../components/KpiCard';
import { SeverityBadge } from '../components/SeverityBadge';
import type { DomainScore } from '../lib/api';

export function Overview() {
  const t = useT();
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');

  const runScan = async () => {
    setScanning(true);
    setScanMsg('');
    try {
      const r = await fetch('/api/scan/run', { method: 'POST' });
      setScanMsg(r.ok ? t('overview.scanStarted') : t('overview.scanFailed'));
    } catch {
      setScanMsg(t('overview.scanFailed'));
    } finally {
      setScanning(false);
    }
  };
  const { ws } = useWorkspace();
  const scores = useLiveRows('scores', '/api/rows/scores', ws);
  const findings = useLiveRows('findings', '/api/rows/findings', ws);
  const cost = useLiveRows('cost_summary', '/api/rows/cost_summary', ws);
  const compliance = useLiveRows('compliance', '/api/rows/compliance', ws);
  const trend = useLiveRows('trend', '/api/rows/trend', ws);
  const { data: maint } = useApi<Record<string, unknown>[]>('/api/rows/maintenance', []);

  // Trend delta: latest overall score minus the previous scan's (spec §20.3).
  const trendRows = trend.rows; // ordered newest-first
  const latestScore = trendRows[0] ? toNum(trendRows[0].overall_score) : null;
  const prevScore = trendRows[1] ? toNum(trendRows[1].overall_score) : null;
  const scoreDelta = latestScore !== null && prevScore !== null ? Math.round((latestScore - prevScore) * 10) / 10 : 0;

  const scoreRows = scores.rows.map(normScore);
  const overall = scoreRows.find((s) => s.isOverall);
  const domainRows = scoreRows.filter((s) => !s.isOverall);
  const coverage = overall?.coveragePct ?? domainRows[0]?.coveragePct ?? 0;

  const domains: DomainScore[] = domainRows.map((s) => ({
    id: s.domain as DomainScore['id'],
    weight: s.weight,
    score: s.score,
    findings: s.findings,
    criticalFindings: s.criticalFindings,
  }));

  const findingRows = findings.rows.map(normFinding);
  const costRows = cost.rows.map(normCost);
  const totalUsd = costRows.reduce((a, c) => a + c.costUsd, 0);
  const aiUsd = costRows.filter((c) => c.isAi).reduce((a, c) => a + c.costUsd, 0);
  const unattributedUsd = costRows
    .filter((c) => c.identity === '(unattributed)')
    .reduce((a, c) => a + c.costUsd, 0);
  const attributedPct = totalUsd > 0 ? Math.round((100 * (totalUsd - unattributedUsd)) / totalUsd) : 0;

  const compRows = compliance.rows.map(normCompliance);
  const primaryFw = compRows[0]?.framework ?? 'dbx-security-best-practices';
  const fwRows = compRows.filter((c) => c.framework === primaryFw);
  const met = fwRows.filter((c) => c.status === 'MET').length;
  const notMet = fwRows.filter((c) => c.status === 'NOT_MET').length;
  const compliancePct = fwRows.length ? Math.round((100 * met) / fwRows.length) : 0;

  const isLive = scores.source === 'live';
  const loading = scores.loading && domainRows.length === 0;

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t('overview.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('overview.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
            style={{
              color: isLive ? 'var(--domain-finops)' : 'var(--sev-medium)',
              background: `color-mix(in oklch, var(${isLive ? '--domain-finops' : '--sev-medium'}) 16%, transparent)`,
            }}
          >
            {isLive ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {isLive ? t('meta.live') : t('meta.demoMode')}
          </span>
          <button
            type="button"
            onClick={runScan}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} style={{ color: 'var(--domain-finops)' }} />
            {scanning ? t('overview.scanning') : t('overview.runScan')}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
          >
            <Sparkles className="h-4 w-4" style={{ color: 'var(--primary)' }} />
            {t('overview.askCompass')}
          </button>
        </div>
      </div>
      {scanMsg && <p className="text-xs text-muted-foreground">{scanMsg}</p>}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="compass-enter flex items-center justify-center rounded-2xl border border-border bg-card p-6">
          {loading ? (
            <div className="h-[220px] w-[220px] animate-pulse rounded-full bg-muted" />
          ) : (
            <HealthRing
              score={overall?.score ?? 0}
              delta={scoreDelta}
              coveragePct={coverage}
              label={t('overview.healthScore')}
              deltaLabel={t('overview.sinceLastScan')}
              coverageLabel={t('overview.coverage')}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <KpiCard
            label={t('overview.aiSpend')}
            value={fmtUsd(totalUsd)}
            sub={
              <span>
                {attributedPct}% {t('overview.attributed')} · {fmtUsd(aiUsd)} AI
              </span>
            }
            accentVar="--domain-finops"
            icon={<DollarSign className="h-4 w-4" />}
          />
          <KpiCard
            label={primaryFw}
            value={`${compliancePct}%`}
            sub={`${met} met · ${notMet} not met`}
            accentVar="--domain-governance"
            icon={<ShieldCheck className="h-4 w-4" />}
          />
          <KpiCard
            label={t('overview.maintenanceDue')}
            value={maint.length}
            sub={`${maint.filter((m) => m.status === 'overdue').length} ${t('overview.overdue').toLowerCase()}`}
            accentVar="--sev-medium"
            icon={<Wrench className="h-4 w-4" />}
          />
          <KpiCard
            label={t('overview.findings')}
            value={findingRows.length}
            sub={`${findingRows.filter((f) => f.severity === 'critical').length} ${t('overview.critical')}`}
            accentVar="--sev-high"
          />
          <KpiCard
            label={t('overview.coverage')}
            value={`${coverage}%`}
            sub={isLive ? t('meta.live') : t('meta.demoMode')}
            accentVar="--primary"
          />
          <KpiCard
            label="Overall"
            value={overall?.score ?? '—'}
            sub={`weighted · ${domainRows.length} ${t('overview.domains').toLowerCase()}`}
            accentVar="--domain-performance"
          />
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t('overview.domains')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {domains.map((d, i) => (
            <DomainCard key={d.id} d={d} index={i} />
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-card-foreground">{t('overview.topFindings')}</h2>
            <NavLink to="/findings" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              {t('overview.viewAll')} <ArrowUpRight className="h-3 w-3" />
            </NavLink>
          </div>
          <ul className="space-y-2">
            {findingRows.length === 0 && <li className="text-sm text-muted-foreground">—</li>}
            {findingRows.slice(0, 5).map((f) => (
              <li key={f.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="tnum rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{f.ruleId}</span>
                    {f.selfCheck && <span className="text-[10px] uppercase text-muted-foreground">self-check</span>}
                  </div>
                  <p className="mt-1 truncate text-sm text-card-foreground">{f.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{f.resource}</p>
                </div>
                <SeverityBadge severity={f.severity} />
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-card-foreground">{t('overview.maintenanceDue')}</h2>
            <NavLink to="/maintenance" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              {t('overview.viewAll')} <ArrowUpRight className="h-3 w-3" />
            </NavLink>
          </div>
          <ul className="space-y-2">
            {maint.length === 0 && <li className="text-sm text-muted-foreground">—</li>}
            {maint.map((m) => {
              const due = daysUntil(String(m.dueAt));
              const overdue = m.status === 'overdue' || due < 0;
              return (
                <li key={String(m.id)} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="tnum rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{String(m.sourceRule)}</span>
                      <span className="text-xs text-muted-foreground">{String(m.owner)}</span>
                    </div>
                    <p className="mt-1 truncate text-sm text-card-foreground">{String(m.resource)}</p>
                  </div>
                  <span
                    className="tnum shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      color: overdue ? 'var(--sev-critical)' : 'var(--sev-medium)',
                      background: `color-mix(in oklch, var(${overdue ? '--sev-critical' : '--sev-medium'}) 16%, transparent)`,
                    }}
                  >
                    {overdue ? t('overview.overdue') : `${fmtDate(String(m.dueAt))}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <p className="pb-2 text-center text-xs text-muted-foreground">{t('meta.advisory')}</p>
    </div>
  );
}
