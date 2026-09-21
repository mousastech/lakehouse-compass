import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Sparkles, Send, Wrench, ShieldAlert, Loader2 } from 'lucide-react';
import { askCompass, splitCitations, type ToolStep } from '../lib/agent';
import { useWorkspace } from '../lib/workspace';
import { useApi } from '../lib/api';
import { useT } from '../lib/i18n';

interface Governance {
  endpoint?: string;
  usage_tracking?: boolean;
  payload_logging?: boolean;
  guardrails?: boolean;
  fully_governed?: boolean;
}

const SUGGESTIONS = [
  'What are my top security risks and why do they matter?',
  'Summarize FinOps: where is my spend and what is unattributed?',
  'How do I improve my Cost Optimization pillar? Cite the WAF controls.',
];

// Render a plain-text segment, turning bare http(s) URLs (e.g. docs links the
// agent cites for WAF controls) into clickable links. Trailing sentence
// punctuation is kept outside the anchor.
const URL_RE = /(https?:\/\/[^\s<]+)/g;
function LinkedText({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) => {
        if (!/^https?:\/\//.test(p)) return <span key={i}>{p}</span>;
        const m = p.match(/[.,;:!?)]+$/);
        const trail = m ? m[0] : '';
        const url = trail ? p.slice(0, -trail.length) : p;
        return (
          <span key={i}>
            <a href={url} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--primary)' }}>
              {url}
            </a>
            {trail}
          </span>
        );
      })}
    </>
  );
}

export function AgentPanel({ autoFocus = false }: { autoFocus?: boolean }) {
  const t = useT();
  const { ws } = useWorkspace();
  const navigate = useNavigate();
  const { data: gov } = useApi<Governance>('/api/agent/governance', {});
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState('');
  const [tools, setTools] = useState<ToolStep[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    answerRef.current?.scrollTo({ top: answerRef.current.scrollHeight });
  }, [answer, tools]);

  const submit = async (question: string) => {
    if (!question.trim() || streaming) return;
    setStreaming(true);
    setAnswer('');
    setTools([]);
    setError('');
    await askCompass(question, ws, {
      onToken: (text) => setAnswer((a) => a + text),
      onTool: (step) => setTools((s) => [...s, step]),
      onToolResult: () => {},
      onDone: () => setStreaming(false),
      onError: (m) => {
        setError(m);
        setStreaming(false);
      },
    });
  };

  const notGoverned = gov && gov.fully_governed === false;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Sparkles className="h-4 w-4" style={{ color: 'var(--primary)' }} />
        <span className="text-sm font-semibold text-foreground">{t('agent.title')}</span>
        {gov?.endpoint && <span className="tnum ml-auto text-[11px] text-muted-foreground">{gov.endpoint}</span>}
      </div>

      {notGoverned && (
        <div
          className="m-3 flex items-start gap-2 rounded-lg border p-2.5 text-xs"
          style={{ borderColor: 'var(--sev-medium)', color: 'var(--sev-medium)' }}
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t('agent.govGap')} — usage_tracking={String(!!gov?.usage_tracking)}, guardrails={String(!!gov?.guardrails)},
            payload_logging={String(!!gov?.payload_logging)}. {t('agent.govGapNote')} [AIG-004]
          </span>
        </div>
      )}

      <div ref={answerRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {tools.length > 0 && (
          <details className="rounded-lg border border-border/60 bg-card/50 p-2 text-xs" open>
            <summary className="cursor-pointer font-medium text-muted-foreground">
              {t('agent.toolSteps')} ({tools.length})
            </summary>
            <ul className="mt-1.5 space-y-1">
              {tools.map((s, i) => (
                <li key={i} className="flex items-center gap-1.5 text-muted-foreground">
                  <Wrench className="h-3 w-3" style={{ color: 'var(--primary)' }} />
                  <span className="tnum">{s.name}</span>
                  {Object.keys(s.args).length > 0 && <span className="opacity-70">{JSON.stringify(s.args)}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}

        {answer ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {splitCitations(answer).map((seg, i) =>
              seg.cite ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => navigate('/findings')}
                  className="tnum mx-0.5 inline-flex items-center rounded px-1 py-0.5 text-[11px] font-medium align-baseline"
                  style={{ color: 'var(--primary)', background: 'color-mix(in oklch, var(--primary) 15%, transparent)' }}
                  title="Open in Findings"
                >
                  {seg.text}
                </button>
              ) : (
                <LinkedText key={i} text={seg.text} />
              )
            )}
            {streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--primary)] align-middle" />}
          </div>
        ) : streaming ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('agent.thinking')}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('agent.suggestions')}</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setQ(s);
                  submit(s);
                }}
                className="block w-full rounded-lg border border-border p-2 text-left text-sm text-foreground hover:border-[var(--primary)]"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border p-2 text-xs" style={{ borderColor: 'var(--sev-high)', color: 'var(--sev-high)' }}>
            {error}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <input
          ref={inputRef}
          id="agent-input"
          name="agent-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('agent.placeholder')}
          className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--primary)]"
        />
        <button
          type="submit"
          disabled={streaming || !q.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
      <p className="px-3 pb-2 text-[10px] text-muted-foreground">{t('agent.disclaimer')}</p>
    </div>
  );
}
