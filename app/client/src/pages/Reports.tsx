import { useState } from 'react';
import { FileText, Loader2, Wifi, WifiOff, Download, ExternalLink } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace, ACCOUNT_MODE } from '../lib/workspace';
import { toNum, toStr } from '../lib/rows';
import { useT } from '../lib/i18n';

export function Reports() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows, source } = useLiveRows('reports', '/api/rows/reports', ws);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  const generate = async () => {
    if (ws === ACCOUNT_MODE) {
      setStatus('error');
      setMsg(t('reports.pickWorkspace'));
      return;
    }
    setStatus('running');
    setMsg('');
    try {
      const r = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: ws }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || String(r.status));
      setStatus('done');
      setMsg(t('reports.started'));
    } catch (e) {
      setStatus('error');
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t('nav.reports')}</h1>
        <div className="flex items-center gap-2">
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
          <button
            type="button"
            onClick={generate}
            disabled={status === 'running'}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            {status === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            {t('reports.generate')}
          </button>
        </div>
      </div>

      {msg && (
        <div
          className="rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: status === 'error' ? 'var(--sev-high)' : 'var(--domain-finops)',
            color: status === 'error' ? 'var(--sev-high)' : 'var(--domain-finops)',
          }}
        >
          {msg}
        </div>
      )}

      <p className="text-sm text-muted-foreground">{t('reports.intro')}</p>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t('reports.col.generated')}</th>
                <th className="px-3 py-2 font-medium">{t('reports.col.workspace')}</th>
                <th className="px-3 py-2 font-medium">{t('reports.col.overall')}</th>
                <th className="px-3 py-2 font-medium">{t('reports.col.coverage')}</th>
                <th className="px-3 py-2 font-medium">{t('reports.col.severity')}</th>
                <th className="px-3 py-2 font-medium">{t('reports.col.path')}</th>
                <th className="px-3 py-2 font-medium">{t('reports.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    {t('reports.none')}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={toStr(r.report_id)} className="border-b border-border/50">
                  <td className="whitespace-nowrap px-3 py-2 text-card-foreground">
                    {toStr(r.generated_at).slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{toStr(r.workspace_name) || toStr(r.workspace_id)}</td>
                  <td className="tnum px-3 py-2 font-semibold text-card-foreground">{toNum(r.overall_score).toFixed(1)}</td>
                  <td className="tnum px-3 py-2 text-muted-foreground">{toNum(r.coverage_pct)}%</td>
                  <td className="tnum px-3 py-2">
                    <span style={{ color: 'var(--sev-critical)' }}>{toNum(r.crit)}C</span>{' '}
                    <span style={{ color: 'var(--sev-high)' }}>{toNum(r.high)}H</span>{' '}
                    <span style={{ color: 'var(--sev-medium)' }}>{toNum(r.med)}M</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    <span className="tnum">{toStr(r.rendered).toUpperCase()}</span> · {toStr(r.volume_path)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {toStr(r.volume_path).startsWith('/Volumes/') ? (
                      <span className="flex items-center gap-2">
                        <a
                          href={`/api/reports/download?path=${encodeURIComponent(toStr(r.volume_path))}`}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                          title={t('reports.download')}
                        >
                          <Download className="h-3.5 w-3.5" /> {t('reports.download')}
                        </a>
                        <a
                          href={`/api/reports/download?inline=1&path=${encodeURIComponent(toStr(r.volume_path))}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                          title={t('reports.open')}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('reports.downloadNote')}</p>
    </div>
  );
}
