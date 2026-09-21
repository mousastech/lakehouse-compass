import { useMemo, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { normFinding, type FindingRow } from '../lib/model';
import { useT } from '../lib/i18n';
import { DOMAIN_META } from '../lib/domains';
import { SeverityBadge } from '../components/SeverityBadge';
import { FindingDrawer } from '../components/FindingDrawer';
import type { DomainId, Severity } from '../lib/api';

const SEV_ORDER: Record<Severity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

export function Findings() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows, loading, source } = useLiveRows('findings', '/api/rows/findings', ws);
  const findings = useMemo(() => rows.map(normFinding), [rows]);

  const [q, setQ] = useState('');
  const [domain, setDomain] = useState<string>('');
  const [sev, setSev] = useState<string>('');
  const [selected, setSelected] = useState<FindingRow | null>(null);

  const domains = useMemo(() => [...new Set(findings.map((f) => f.domain))], [findings]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return findings
      .filter((f) => (domain ? f.domain === domain : true))
      .filter((f) => (sev ? f.severity === sev : true))
      .filter((f) =>
        needle
          ? [f.ruleId, f.title, f.resource].some((s) => s.toLowerCase().includes(needle))
          : true
      )
      .sort((a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity]);
  }, [findings, q, domain, sev]);

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t('nav.findings')}</h1>
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

      <div className="flex flex-wrap gap-2">
        <input
          id="findings-search"
          name="findings-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('findings.search')}
          className="min-w-[220px] flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none focus:border-[var(--primary)]"
        />
        <select
          id="findings-domain"
          name="findings-domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">{t('findings.allDomains')}</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {t(DOMAIN_META[d as DomainId]?.tKey ?? d)}
            </option>
          ))}
        </select>
        <select
          id="findings-severity"
          name="findings-severity"
          value={sev}
          onChange={(e) => setSev(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">{t('findings.allSeverities')}</option>
          {(['critical', 'high', 'medium', 'low', 'info'] as Severity[]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t('findings.col.rule')}</th>
                <th className="px-3 py-2 font-medium">{t('findings.col.severity')}</th>
                <th className="px-3 py-2 font-medium">{t('findings.col.domain')}</th>
                <th className="px-3 py-2 font-medium">{t('findings.col.title')}</th>
                <th className="px-3 py-2 font-medium">{t('findings.col.resource')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    …
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    {t('findings.none')}
                  </td>
                </tr>
              )}
              {filtered.map((f) => (
                <tr
                  key={f.id}
                  onClick={() => setSelected(f)}
                  className="cursor-pointer border-b border-border/50 transition-colors hover:bg-accent/50"
                >
                  <td className="tnum whitespace-nowrap px-3 py-2 font-medium text-muted-foreground">{f.ruleId}</td>
                  <td className="px-3 py-2">
                    <SeverityBadge severity={f.severity} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: `var(${DOMAIN_META[f.domain]?.colorVar ?? '--primary'})` }}
                      />
                      {t(DOMAIN_META[f.domain]?.tKey ?? f.domain)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-card-foreground">{f.title}</td>
                  <td className="px-3 py-2 text-muted-foreground">{f.resource}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <FindingDrawer finding={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
