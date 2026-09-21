import { Database, ShieldAlert } from 'lucide-react';
import { useApi } from '../lib/api';
import { useT } from '../lib/i18n';
import { NotAvailable } from '../components/SourceBadge';
import { FindingsList } from '../components/FindingsList';

interface Instance {
  name: string;
  state: string;
  capacity: string;
  stopped: boolean;
}
interface LakebaseResp {
  instances_available?: boolean;
  pg_available?: boolean;
  reason?: string;
  pg_grant_needed?: string;
  instances?: Instance[];
}

export function Lakebase() {
  const t = useT();
  const { data, loading } = useApi<LakebaseResp>('/api/lakebase', {});

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <h1 className="text-xl font-semibold text-foreground">{t('nav.lakebase')}</h1>

      {loading && <p className="text-sm text-muted-foreground">…</p>}

      {!loading && data.instances_available === false && (
        <NotAvailable title={t('lakebase.naTitle')} reason={data.reason || t('lakebase.naReason')} />
      )}

      {!loading && data.instances_available && (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-semibold text-card-foreground">
            <Database className="h-4 w-4" style={{ color: 'var(--domain-lakebase)' }} /> {t('lakebase.instances')}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t('lakebase.col.name')}</th>
                  <th className="px-3 py-2 font-medium">{t('lakebase.col.state')}</th>
                  <th className="px-3 py-2 font-medium">{t('lakebase.col.capacity')}</th>
                </tr>
              </thead>
              <tbody>
                {(data.instances || []).length === 0 && (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">—</td></tr>
                )}
                {(data.instances || []).map((i) => (
                  <tr key={i.name} className="border-b border-border/50">
                    <td className="px-3 py-2 text-card-foreground">{i.name}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: i.stopped ? 'var(--muted-foreground)' : 'var(--domain-finops)', background: `color-mix(in oklch, var(${i.stopped ? '--muted-foreground' : '--domain-finops'}) 14%, transparent)` }}>{i.state}</span>
                    </td>
                    <td className="tnum px-3 py-2 text-muted-foreground">{i.capacity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && data.pg_grant_needed && (
        <div className="flex items-start gap-2 rounded-xl border p-3 text-xs" style={{ borderColor: 'var(--domain-finops)', color: 'var(--domain-finops)' }}>
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span><b>{t('lakebase.pgEnabled')}</b> {data.pg_grant_needed}</span>
        </div>
      )}

      <FindingsList domain="lakebase" />
    </div>
  );
}
