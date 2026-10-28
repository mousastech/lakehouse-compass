import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '../lib/i18n';
import { toNum, toStr } from '../lib/rows';
import { FillerRows, Pager, usePaged } from './Pager';

interface Review {
  id: string;
  fq: string;
  comment: string;
  verdict: string;
  score: number;
  reason: string;
  suggestion: string;
  model: string;
}

interface EvalReport {
  judged: number;
  items: number;
  exact_agreement: number;
  binary_agreement: number;
  mismatches: { id: string; fq: string; comment: string; label: string; verdict: string; reason: string }[];
  model: string;
  errors: string[];
}

const VERDICT_VAR: Record<string, string> = { good: '--domain-finops', weak: '--sev-medium', poor: '--sev-high' };
const PAGE_SIZE = 10;

async function postJson(url: string, body: unknown): Promise<any> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

/**
 * In-app LLM review of priority column descriptions (N2) and drafting of the
 * suggested rewrites as ProposedChanges (N3). The judge runs on the governed
 * compass-llm endpoint; nothing is ever executed from here.
 */
export function DescriptionReviewPanel({ ws }: { ws: string }) {
  const t = useT();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [pending, setPending] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<'' | 'review' | 'eval' | 'propose'>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [evalReport, setEvalReport] = useState<EvalReport | null>(null);
  const [filter, setFilter] = useState<'weak_poor' | 'all'>('weak_poor');

  const load = useCallback(async () => {
    if (!ws) return;
    try {
      const r = await fetch(`/api/metadata/reviews?ws=${encodeURIComponent(ws)}`);
      const j = await r.json();
      setReviews(
        ((j.reviews as Record<string, unknown>[]) || []).map((x) => ({
          id: toStr(x.review_id),
          fq: `${toStr(x.catalog)}.${toStr(x.schema)}.${toStr(x.table)}.${toStr(x.column)}`,
          comment: toStr(x.comment),
          verdict: toStr(x.verdict),
          score: toNum(x.score),
          reason: toStr(x.reason),
          suggestion: toStr(x.suggestion),
          model: toStr(x.model),
        }))
      );
      setPending(toNum(j.pending));
    } catch {
      setReviews([]);
    } finally {
      setLoaded(true);
    }
  }, [ws]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { good: 0, weak: 0, poor: 0 };
    for (const r of reviews) c[r.verdict] = (c[r.verdict] ?? 0) + 1;
    return c;
  }, [reviews]);
  const visible = useMemo(() => (filter === 'all' ? reviews : reviews.filter((r) => r.verdict !== 'good')), [filter, reviews]);
  const paged = usePaged(visible, PAGE_SIZE, `${filter}:${reviews.length}`);

  const run = async (kind: 'review' | 'eval' | 'propose') => {
    setBusy(kind);
    setError('');
    setMessage('');
    try {
      if (kind === 'review') {
        const j = await postJson('/api/metadata/review', { ws });
        setMessage(j.reviewed ? `${t('mdr.reviewedN')}: ${j.reviewed} (${j.verdicts?.good ?? 0} ${t('mdr.v.good')} · ${j.verdicts?.weak ?? 0} ${t('mdr.v.weak')} · ${j.verdicts?.poor ?? 0} ${t('mdr.v.poor')})` : t('mdr.nothingNew'));
        if (j.errors?.length) setError(j.errors.join(' · '));
        await load();
      } else if (kind === 'eval') {
        setEvalReport(await postJson('/api/metadata/eval', {}));
      } else {
        const j = await postJson('/api/metadata/propose', { ws, review_ids: [...selected] });
        setMessage(`${t('mdr.proposedN')}: ${j.proposed}`);
        setSelected(new Set());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (!ws) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-6" aria-busy={!loaded}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-sm font-semibold text-card-foreground">{t('mdr.title')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('mdr.help')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!busy || pending === 0}
            onClick={() => run('review')}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-50"
          >
            {busy === 'review' ? t('mdr.reviewing') : `${t('mdr.reviewNext')} (${Math.min(36, pending)} / ${pending})`}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => run('eval')}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-card-foreground transition-colors hover:bg-accent/50 disabled:opacity-50"
          >
            {busy === 'eval' ? t('mdr.measuring') : t('mdr.measure')}
          </button>
        </div>
      </div>

      {(message || error) && (
        <div className="mt-3 space-y-1 text-xs" role="status">
          {message && <p className="text-card-foreground">{message}{message.startsWith(t('mdr.proposedN')) && <> · <a href="/changes" className="underline">{t('mdr.openChanges')}</a></>}</p>}
          {error && <p style={{ color: 'var(--sev-high)' }}>{error}</p>}
        </div>
      )}

      {evalReport && (
        <div className="mt-4 rounded-lg border border-border/60 p-3 text-xs">
          <div className="text-card-foreground">
            {t('mdr.agreement')}: <span className="tnum font-semibold">{evalReport.exact_agreement}%</span> {t('mdr.exact')} ·{' '}
            <span className="tnum font-semibold">{evalReport.binary_agreement}%</span> {t('mdr.binary')} ·{' '}
            <span className="tnum">{evalReport.judged}/{evalReport.items}</span> {t('mdr.judged')} · {evalReport.model}
          </div>
          {evalReport.mismatches.length > 0 && (
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {evalReport.mismatches.slice(0, 8).map((m) => (
                <li key={m.id}>
                  <span className="font-mono">“{m.comment}”</span> — {t('mdr.label')} {t(`mdr.v.${m.label}`)}, {t('mdr.judge')} {t(`mdr.v.${m.verdict}`)}: {m.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {reviews.length > 0 && (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2 text-[11px]">
              {(['good', 'weak', 'poor'] as const).map((v) => (
                <span key={v} className="rounded-full px-2.5 py-1" style={{ color: `var(${VERDICT_VAR[v]})`, background: `color-mix(in oklch, var(${VERDICT_VAR[v]}) 14%, transparent)` }}>
                  {t(`mdr.v.${v}`)} · <span className="tnum">{counts[v] ?? 0}</span>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div role="tablist" className="inline-flex rounded-lg border border-border p-0.5 text-xs">
                {(['weak_poor', 'all'] as const).map((f) => (
                  <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                    className={`rounded-md px-2.5 py-1 ${filter === f ? 'bg-primary/15 font-medium text-foreground' : 'text-muted-foreground'}`}>
                    {t(`mdr.filter.${f}`)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={!!busy || selected.size === 0}
                onClick={() => run('propose')}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-card-foreground transition-colors hover:bg-accent/50 disabled:opacity-50"
              >
                {busy === 'propose' ? t('mdr.proposing') : `${t('mdr.propose')} (${selected.size})`}
              </button>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-8 px-2 py-2"><span className="sr-only">{t('mdr.select')}</span></th>
                  <th className="px-3 py-2 font-medium">{t('prot.col.column')}</th>
                  <th className="px-3 py-2 font-medium">{t('mdr.col.current')}</th>
                  <th className="px-3 py-2 font-medium">{t('mdr.col.verdict')}</th>
                  <th className="px-3 py-2 font-medium">{t('mdr.col.suggestion')}</th>
                </tr>
              </thead>
              <tbody>
                {paged.slice.map((r) => (
                  <tr key={r.id} className="h-16 border-b border-border/50 align-top">
                    <td className="px-2 py-2">
                      {r.suggestion && (
                        <input type="checkbox" aria-label={`${t('mdr.select')} ${r.fq}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                      )}
                    </td>
                    <td className="max-w-[16rem] px-3 py-2 font-mono text-[11px] text-card-foreground"><span className="line-clamp-2 break-all" title={r.fq}>{r.fq}</span></td>
                    <td className="max-w-[16rem] px-3 py-2 text-xs text-muted-foreground"><span className="line-clamp-2" title={r.comment}>{r.comment}</span></td>
                    <td className="max-w-[16rem] px-3 py-2 text-xs">
                      <span style={{ color: `var(${VERDICT_VAR[r.verdict] ?? '--sev-medium'})` }}>{t(`mdr.v.${r.verdict}`)}</span>{' '}
                      <span className="tnum text-muted-foreground">{r.score}</span>
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground" title={r.reason}>{r.reason}</div>
                    </td>
                    <td className="max-w-[20rem] px-3 py-2 text-xs text-card-foreground">
                      {r.suggestion ? <span className="line-clamp-2" title={r.suggestion}>{r.suggestion}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
                <FillerRows count={paged.filler} cols={5} rowClass="h-16" />
              </tbody>
            </table>
          </div>
          <Pager {...paged} label={t('mdr.title')} />
        </>
      )}
      {!loaded && <div className="mt-4 h-24 animate-pulse rounded-lg bg-muted/40" />}
      {loaded && reviews.length === 0 && <p className="mt-4 text-xs text-muted-foreground">{pending ? t('mdr.none') : t('mdr.noCandidates')}</p>}
    </section>
  );
}
