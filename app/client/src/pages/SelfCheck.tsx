import { CheckCircle2, XCircle, AlertTriangle, Stethoscope } from 'lucide-react';
import { useApi } from '../lib/api';
import { toStr } from '../lib/rows';
import { useT } from '../lib/i18n';

interface Item {
  id: string;
  rule_id: string;
  title: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  severity: string;
  detail: string;
}

const ICON = { PASS: CheckCircle2, FAIL: XCircle, WARN: AlertTriangle };
const COLOR = { PASS: '--domain-finops', FAIL: '--sev-critical', WARN: '--sev-medium' };

export function SelfCheck() {
  const t = useT();
  const { data, loading } = useApi<Item[]>('/api/selfcheck', []);

  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      <div className="flex items-center gap-2">
        <Stethoscope className="h-5 w-5" style={{ color: 'var(--primary)' }} />
        <h1 className="text-xl font-semibold text-foreground">{t('nav.self_check')}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{t('selfcheck.subtitle')}</p>

      {loading && <p className="text-sm text-muted-foreground">…</p>}
      <div className="space-y-2">
        {data.map((it) => {
          const Icon = ICON[it.status] ?? AlertTriangle;
          const color = `var(${COLOR[it.status] ?? '--muted-foreground'})`;
          return (
            <div key={it.id} className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
              <Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-card-foreground">{it.title}</span>
                  {it.rule_id !== '—' && <span className="tnum rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{toStr(it.rule_id)}</span>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{it.detail}</p>
              </div>
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase" style={{ color, background: `color-mix(in oklch, ${color} 15%, transparent)` }}>
                {it.status}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t('selfcheck.note')}</p>
    </div>
  );
}
