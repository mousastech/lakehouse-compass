import { X } from 'lucide-react';
import { useT } from '../lib/i18n';
import { DOMAIN_META } from '../lib/domains';
import { SeverityBadge } from './SeverityBadge';
import type { FindingRow } from '../lib/model';

export function FindingDrawer({ finding, onClose }: { finding: FindingRow | null; onClose: () => void }) {
  const t = useT();
  const open = finding !== null;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 transition-opacity"
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}
        aria-hidden
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl"
        style={{
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform var(--dur-base) var(--ease)',
        }}
        role="dialog"
        aria-hidden={!open}
      >
        {finding && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-border p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="tnum rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {finding.ruleId}
                  </span>
                  <SeverityBadge severity={finding.severity} />
                  {finding.selfCheck && (
                    <span className="text-[10px] uppercase text-muted-foreground">{t('findings.selfCheck')}</span>
                  )}
                </div>
                <h2 className="mt-2 text-base font-semibold text-card-foreground">{finding.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{finding.resource}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div className="flex flex-wrap gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    color: `var(${DOMAIN_META[finding.domain]?.colorVar ?? '--primary'})`,
                    background: `color-mix(in oklch, var(${DOMAIN_META[finding.domain]?.colorVar ?? '--primary'}) 16%, transparent)`,
                  }}
                >
                  {t(DOMAIN_META[finding.domain]?.tKey ?? 'nav.findings')}
                </span>
              </div>

              {Object.keys(finding.evidence).length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('findings.evidence')}
                  </h3>
                  <dl className="space-y-1 rounded-lg border border-border/60 p-3">
                    {Object.entries(finding.evidence).map(([k, v]) => (
                      <div key={k} className="flex items-start justify-between gap-3 text-sm">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="tnum text-right font-medium text-card-foreground">
                          {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              {finding.remediation && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('findings.remediation')}
                  </h3>
                  <p className="rounded-lg border border-border/60 p-3 text-sm text-card-foreground">
                    {finding.remediation}
                  </p>
                </section>
              )}

              {finding.frameworkControls.length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('findings.controls')}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {finding.frameworkControls.map((c) => (
                      <span key={c} className="tnum rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {c}
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
