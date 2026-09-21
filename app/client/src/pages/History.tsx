import { useEffect, useMemo, useState } from 'react';
import { History as HistoryIcon } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { toNum, toStr, asRows } from '../lib/rows';
import { normFinding, type FindingRow } from '../lib/model';
import { useT } from '../lib/i18n';
import { SourceBadge } from '../components/SourceBadge';
import { SeverityBadge } from '../components/SeverityBadge';
import { FindingDrawer } from '../components/FindingDrawer';
import { TrendChart, type TrendPoint } from '../components/TrendChart';

export function History() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows, source } = useLiveRows('trend', '/api/rows/trend', ws);

  // scan_runs come newest-first; reverse for a left→right timeline.
  const scans = useMemo(() => rows.map((r) => ({
    scan_id: toStr(r.scan_id),
    when: toStr(r.generated_at),
    score: toNum(r.overall_score),
    coverage: toNum(r.coverage_pct),
    crit: toNum(r.crit), high: toNum(r.high), med: toNum(r.med), low: toNum(r.low),
    total: toNum(r.total_findings),
  })), [rows]);
  const points: TrendPoint[] = useMemo(
    () => [...scans].reverse().map((s) => ({ label: s.when.slice(0, 10), score: s.score, coverage: s.coverage })),
    [scans]
  );

  const [a, setA] = useState('');
  const [b, setB] = useState('');
  useEffect(() => {
    if (scans.length && !a) setA(scans[0].scan_id);
    if (scans.length > 1 && !b) setB(scans[1].scan_id);
  }, [scans, a, b]);

  const [diff, setDiff] = useState<{ new: FindingRow[]; resolved: FindingRow[]; regressed: FindingRow[] } | null>(null);
  const [selected, setSelected] = useState<FindingRow | null>(null);
  useEffect(() => {
    if (!a || !b) return;
    fetch(`/api/history/diff?ws=${ws}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => setDiff({
        new: asRows(j.new).map(normFinding),
        resolved: asRows(j.resolved).map(normFinding),
        regressed: asRows(j.regressed).map(normFinding),
      }))
      .catch(() => setDiff({ new: [], resolved: [], regressed: [] }));
  }, [a, b, ws]);

  const Section = ({ titleKey, items, color }: { titleKey: string; items: FindingRow[]; color: string }) => (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="tnum text-lg font-semibold" style={{ color: `var(${color})` }}>{items.length}</span>
        <span className="text-sm font-medium text-card-foreground">{t(titleKey)}</span>
      </div>
      <ul className="space-y-1.5">
        {items.length === 0 && <li className="text-xs text-muted-foreground">—</li>}
        {items.map((f) => (
          <li key={f.id + f.ruleId} onClick={() => setSelected(f)} className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border/60 p-2 hover:bg-accent/50">
            <span className="flex items-center gap-2 text-sm">
              <span className="tnum rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{f.ruleId}</span>
              <span className="truncate text-card-foreground">{f.title}</span>
            </span>
            <SeverityBadge severity={f.severity} />
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <HistoryIcon className="h-5 w-5" style={{ color: 'var(--primary)' }} />
          <h1 className="text-xl font-semibold text-foreground">{t('nav.history')}</h1>
        </div>
        <SourceBadge source={source} />
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-card-foreground">{t('history.trend')}</h2>
        <TrendChart points={points} />
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-2.5 text-sm font-semibold text-card-foreground">{t('history.scans')}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t('history.col.when')}</th>
                <th className="px-3 py-2 font-medium">{t('history.col.score')}</th>
                <th className="px-3 py-2 font-medium">{t('history.col.coverage')}</th>
                <th className="px-3 py-2 font-medium">C / H / M / L</th>
                <th className="px-3 py-2 font-medium">{t('history.col.findings')}</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <tr key={s.scan_id} className="border-b border-border/50">
                  <td className="whitespace-nowrap px-3 py-2 text-card-foreground">{s.when.slice(0, 16).replace('T', ' ')}</td>
                  <td className="tnum px-3 py-2 font-semibold">{s.score}</td>
                  <td className="tnum px-3 py-2 text-muted-foreground">{s.coverage}%</td>
                  <td className="tnum px-3 py-2 text-muted-foreground">{s.crit}/{s.high}/{s.med}/{s.low}</td>
                  <td className="tnum px-3 py-2 text-muted-foreground">{s.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-card-foreground">{t('history.compare')}</h2>
          <div className="flex items-center gap-2 text-xs">
            <label className="text-muted-foreground">{t('history.newer')}</label>
            <select id="hist-a" name="hist-a" value={a} onChange={(e) => setA(e.target.value)} className="rounded-md border border-border bg-card px-2 py-1 text-foreground">
              {scans.map((s) => <option key={s.scan_id} value={s.scan_id}>{s.when.slice(0, 16).replace('T', ' ')}</option>)}
            </select>
            <label className="text-muted-foreground">{t('history.older')}</label>
            <select id="hist-b" name="hist-b" value={b} onChange={(e) => setB(e.target.value)} className="rounded-md border border-border bg-card px-2 py-1 text-foreground">
              {scans.map((s) => <option key={s.scan_id} value={s.scan_id}>{s.when.slice(0, 16).replace('T', ' ')}</option>)}
            </select>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Section titleKey="history.newFindings" items={diff?.new ?? []} color="--sev-critical" />
          <Section titleKey="history.resolved" items={diff?.resolved ?? []} color="--domain-finops" />
          <Section titleKey="history.regressed" items={diff?.regressed ?? []} color="--sev-medium" />
        </div>
      </section>

      <FindingDrawer finding={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
