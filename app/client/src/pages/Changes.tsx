import { useCallback, useEffect, useState } from 'react';
import { Check, X, HelpCircle, GitPullRequestArrow } from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import { toStr } from '../lib/rows';
import { useT } from '../lib/i18n';

interface Change {
  change_id: string;
  finding_id: string;
  rule_id: string;
  title: string;
  steps: string;
  code: string;
  rollback: string;
  blast_radius: string;
  confidence: string;
  status: string;
  created_by: string;
  created_at: string;
  decided_by?: string;
  decided_at?: string;
}

const STATUS_COLOR: Record<string, string> = {
  APPROVED: '--domain-finops',
  REJECTED: '--sev-critical',
  NEEDS_INFO: '--sev-medium',
};

export function Changes() {
  const t = useT();
  const { ws } = useWorkspace();
  const [rows, setRows] = useState<Change[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>('');
  const [err, setErr] = useState<string>('');

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/changes${ws ? `?ws=${ws}` : ''}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => setRows(Array.isArray(j) ? j : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [ws]);

  useEffect(() => load(), [load]);

  const decide = async (id: string, status: string) => {
    setBusy(id);
    setErr('');
    try {
      const r = await fetch('/api/changes/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ change_id: id, status }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        setErr(b.error || `Failed (${r.status})`);
      } else {
        load();
      }
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="mx-auto max-w-[1000px] space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t('nav.changes')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('changes.subtitle')}</p>
      </div>

      {err && (
        <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--sev-high)', color: 'var(--sev-high)' }}>{err}</div>
      )}
      {loading && <p className="text-sm text-muted-foreground">…</p>}
      {!loading && rows.length === 0 && (
        <div className="grid place-items-center rounded-2xl border border-dashed border-border p-12 text-center">
          <GitPullRequestArrow className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('changes.none')}</p>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((c) => (
          <div key={c.change_id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="tnum rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{toStr(c.rule_id)}</span>
                <span className="text-sm font-semibold text-card-foreground">{toStr(c.title)}</span>
              </div>
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase"
                style={{
                  color: `var(${STATUS_COLOR[c.status] ?? '--muted-foreground'})`,
                  background: `color-mix(in oklch, var(${STATUS_COLOR[c.status] ?? '--primary'}) 15%, transparent)`,
                }}
              >
                {toStr(c.status)}
              </span>
            </div>
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p><b className="text-card-foreground">{t('changes.steps')}:</b> {toStr(c.steps)}</p>
              <p><b className="text-card-foreground">{t('changes.rollback')}:</b> {toStr(c.rollback)}</p>
              <p>
                <b className="text-card-foreground">{t('changes.blast')}:</b> {toStr(c.blast_radius)} ·{' '}
                <b className="text-card-foreground">{t('changes.confidence')}:</b> {toStr(c.confidence)} ·{' '}
                finding {toStr(c.finding_id)} · {toStr(c.created_by)}
              </p>
              {c.decided_by && (
                <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  {t('changes.decidedBy')} <b>{toStr(c.decided_by)}</b>{c.decided_at ? ` · ${toStr(c.decided_at).slice(0, 16).replace('T', ' ')}` : ''}
                </p>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busy === c.change_id} onClick={() => decide(c.change_id, 'APPROVED')}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent" style={{ color: 'var(--domain-finops)' }}>
                <Check className="h-3.5 w-3.5" /> {t('changes.approve')}
              </button>
              <button type="button" disabled={busy === c.change_id} onClick={() => decide(c.change_id, 'REJECTED')}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent" style={{ color: 'var(--sev-critical)' }}>
                <X className="h-3.5 w-3.5" /> {t('changes.reject')}
              </button>
              <button type="button" disabled={busy === c.change_id} onClick={() => decide(c.change_id, 'NEEDS_INFO')}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent text-muted-foreground">
                <HelpCircle className="h-3.5 w-3.5" /> {t('changes.needsInfo')}
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t('changes.advisory')}</p>
    </div>
  );
}
