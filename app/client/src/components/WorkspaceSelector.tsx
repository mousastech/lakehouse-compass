import { Building2, Globe } from 'lucide-react';
import { useWorkspace, ACCOUNT_MODE } from '../lib/workspace';

const ENV_COLOR: Record<string, string> = {
  prod: '--sev-critical',
  'non-prod': '--sev-medium',
  staging: '--sev-medium',
  sandbox: '--domain-usage',
  dev: '--domain-performance',
  demo: '--domain-genie',
};

export function WorkspaceSelector() {
  const { ws, setWs, workspaces } = useWorkspace();
  const account = ws === ACCOUNT_MODE;
  const current = workspaces.find((w) => w.id === ws);

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">
        {account ? <Globe className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
      </span>
      <select
        id="workspace-select"
        name="workspace"
        value={ws}
        onChange={(e) => setWs(e.target.value)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm font-medium text-foreground outline-none focus:border-[var(--primary)]"
        title="Workspace"
      >
        <option value={ACCOUNT_MODE}>All workspaces (Account mode)</option>
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
            {w.env && w.env !== 'unknown' ? ` · ${w.env}` : ''}
          </option>
        ))}
      </select>
      {!account && current?.env && current.env !== 'unknown' && (
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            color: `var(${ENV_COLOR[current.env] ?? '--muted-foreground'})`,
            background: `color-mix(in oklch, var(${ENV_COLOR[current.env] ?? '--primary'}) 15%, transparent)`,
          }}
        >
          {current.env}
        </span>
      )}
    </div>
  );
}
