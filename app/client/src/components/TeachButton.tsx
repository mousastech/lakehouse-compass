import { useState } from 'react';
import { GraduationCap, Loader2 } from 'lucide-react';
import { useT } from '../lib/i18n';

export interface TeachContext {
  domain: string;
  ruleId: string;
  title: string;
  remediation: string;
  resource: string;
}

// Minimal, dependency-free renderer for the model's light markdown: **bold**,
// `code`, and line breaks. Renders one <p> per line so numbered steps read well.
function renderSteps(text: string) {
  return text.split('\n').map((line, i) => {
    if (!line.trim()) return <div key={i} className="h-2" />;
    const nodes = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((seg, j) => {
      if (seg.startsWith('**') && seg.endsWith('**')) return <strong key={j} className="text-foreground">{seg.slice(2, -2)}</strong>;
      if (seg.startsWith('`') && seg.endsWith('`')) return <code key={j} className="rounded bg-muted px-1 py-0.5 text-[11px]">{seg.slice(1, -1)}</code>;
      return <span key={j}>{seg}</span>;
    });
    return <p key={i}>{nodes}</p>;
  });
}

/** "How to apply" — asks the governed Claude endpoint (compass-llm) for concrete,
 * step-by-step Databricks instructions to apply a specific finding's fix. */
export function TeachButton({ ctx }: { ctx: TeachContext }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState('');
  const [error, setError] = useState('');

  const run = async () => {
    if (steps || loading) {
      setOpen((o) => !o);
      return;
    }
    setLoading(true);
    setError('');
    setOpen(true);
    try {
      const r = await fetch('/api/teach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ctx),
      });
      const j = (await r.json()) as { steps?: string; error?: string };
      if (r.ok && j.steps) setSteps(j.steps);
      else setError(j.error || t('teach.error'));
    } catch {
      setError(t('teach.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={run}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GraduationCap className="h-3.5 w-3.5" style={{ color: 'var(--primary)' }} />}
        {t('teach.button')}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-card-foreground">
          {loading && <p className="text-muted-foreground">{t('teach.loading')}</p>}
          {error && <p style={{ color: 'var(--sev-high)' }}>{error}</p>}
          {steps && <div className="space-y-1">{renderSteps(steps)}</div>}
          {steps && <p className="mt-2 text-[10px] text-muted-foreground">{t('teach.disclaimer')}</p>}
        </div>
      )}
    </div>
  );
}
