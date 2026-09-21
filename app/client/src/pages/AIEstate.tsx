import { useMemo } from 'react';
import { BrainCircuit, Cpu, ShieldAlert } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { useApi } from '../lib/api';
import { normCost } from '../lib/model';
import { toStr } from '../lib/rows';
import { useT } from '../lib/i18n';
import { fmtUsd } from '../lib/format';
import { KpiCard } from '../components/KpiCard';
import { SourceBadge } from '../components/SourceBadge';
import { FindingsList } from '../components/FindingsList';

interface Gov {
  endpoint?: string;
  usage_tracking?: boolean;
  guardrails?: boolean;
  payload_logging?: boolean;
  fully_governed?: boolean;
}

export function AIEstate() {
  const t = useT();
  const { ws } = useWorkspace();
  const endpoints = useLiveRows('ai_estate', '/api/rows/ai_estate', ws);
  const cost = useLiveRows('cost_summary', '/api/rows/cost_summary', ws);
  const { data: gov } = useApi<Gov>('/api/agent/governance', {});

  const aiUsd = useMemo(
    () => cost.rows.map(normCost).filter((c) => c.isAi).reduce((a, c) => a + c.costUsd, 0),
    [cost.rows]
  );
  const eps = endpoints.rows;
  const external = eps.filter((e) => toStr(e.entity_type) === 'EXTERNAL_MODEL').length;
  const individual = eps.filter((e) => toStr(e.owner).includes('@')).length;

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t('nav.ai_estate')}</h1>
        <SourceBadge source={endpoints.source} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label={t('aie.endpoints')} value={eps.length} accentVar="--domain-ai_estate" icon={<BrainCircuit className="h-4 w-4" />} />
        <KpiCard label={t('aie.aiSpend')} value={fmtUsd(aiUsd)} accentVar="--domain-finops" icon={<Cpu className="h-4 w-4" />} />
        <KpiCard label={t('aie.external')} value={external} accentVar="--sev-medium" />
        <KpiCard label={t('aie.individual')} value={individual} accentVar="--sev-high" />
      </div>

      {gov?.endpoint && (
        <div
          className="flex items-start gap-2 rounded-xl border p-3 text-sm"
          style={{
            borderColor: gov.fully_governed ? 'var(--domain-finops)' : 'var(--sev-medium)',
            color: gov.fully_governed ? 'var(--domain-finops)' : 'var(--sev-medium)',
          }}
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t('aie.govStatus')} <b>{gov.endpoint}</b>: usage_tracking={String(!!gov.usage_tracking)}, guardrails={String(!!gov.guardrails)}, payload_logging={String(!!gov.payload_logging)}.
            {!gov.fully_governed && ` ${t('aie.govGap')} [AIG-004]`}
          </span>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-2.5 text-sm font-semibold text-card-foreground">{t('aie.inventory')}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t('aie.col.endpoint')}</th>
                <th className="px-3 py-2 font-medium">{t('aie.col.type')}</th>
                <th className="px-3 py-2 font-medium">{t('aie.col.owner')}</th>
              </tr>
            </thead>
            <tbody>
              {eps.length === 0 && (
                <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">{t('aie.none')}</td></tr>
              )}
              {eps.map((e, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="px-3 py-2 text-card-foreground">{toStr(e.endpoint_name)}</td>
                  <td className="px-3 py-2">
                    <span className="tnum rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{toStr(e.entity_type)}</span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground" style={{ color: toStr(e.owner).includes('@') ? 'var(--sev-high)' : undefined }}>
                    {toStr(e.owner)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <FindingsList domain="ai_estate" />
      <p className="text-xs text-muted-foreground">{t('aie.note')}</p>
    </div>
  );
}
