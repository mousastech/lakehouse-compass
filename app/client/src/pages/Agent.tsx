import { useT } from '../lib/i18n';
import { AgentPanel } from '../components/AgentPanel';

export function Agent() {
  const t = useT();
  return (
    <div className="mx-auto max-w-[920px]">
      <h1 className="mb-1 text-xl font-semibold text-foreground">{t('nav.agent')}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t('agent.subtitle')}</p>
      <div className="h-[72vh] overflow-hidden rounded-2xl border border-border bg-card">
        <AgentPanel autoFocus />
      </div>
    </div>
  );
}
