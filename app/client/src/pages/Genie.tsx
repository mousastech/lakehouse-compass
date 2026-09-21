import { Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useApi } from '../lib/api';
import { useT } from '../lib/i18n';
import { NotAvailable } from '../components/SourceBadge';
import { FindingsList } from '../components/FindingsList';

interface GenieSpace {
  space_id: string;
  title: string;
  has_description: boolean;
  tables: number;
  warehouse: string;
}
interface GenieResp {
  available?: boolean;
  reason?: string;
  total?: number;
  sampled?: number;
  spaces?: GenieSpace[];
}

export function Genie() {
  const t = useT();
  const { data, loading } = useApi<GenieResp>('/api/genie', {});

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <h1 className="text-xl font-semibold text-foreground">{t('nav.genie')}</h1>

      {loading && <p className="text-sm text-muted-foreground">…</p>}

      {!loading && data.available === false && (
        <NotAvailable title={t('genie.naTitle')} reason={data.reason || t('genie.naReason')} />
      )}

      {!loading && data.available && (
        <>
          <p className="text-sm text-muted-foreground">
            {t('genie.discovered')}: <span className="tnum font-semibold text-foreground">{data.total}</span> · {t('genie.sampled')} {data.sampled}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(data.spaces || []).map((s) => (
              <div key={s.space_id} className="compass-enter rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--domain-genie)' }} />
                  <span className="text-sm font-semibold text-card-foreground">{s.title}</span>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  {s.has_description ? (
                    <span className="inline-flex items-center gap-1" style={{ color: 'var(--domain-finops)' }}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> {t('genie.hasDesc')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1" style={{ color: 'var(--sev-medium)' }}>
                      <AlertTriangle className="h-3.5 w-3.5" /> {t('genie.noDesc')}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{t('genie.tables')}: {s.tables}{s.warehouse ? ` · wh ${s.warehouse.slice(0, 8)}` : ''}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <FindingsList domain="genie" />
    </div>
  );
}
