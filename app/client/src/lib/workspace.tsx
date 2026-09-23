import { createContext, useContext, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useLiveRows } from './analytics';
import { toStr } from './rows';

export const ACCOUNT_MODE = ''; // empty ws = all workspaces

export interface WorkspaceOption {
  id: string;
  name: string;
  env: string;
}

interface WorkspaceCtx {
  ws: string; // '' = account mode
  setWs: (ws: string) => void;
  workspaces: WorkspaceOption[];
}

const Ctx = createContext<WorkspaceCtx | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();

  // Scanned workspaces for this deployment (workspaces.sql, ordered latest-scan first).
  const { rows, source } = useLiveRows('workspaces', '/api/rows/workspaces');
  const workspaces: WorkspaceOption[] = rows.map((r) => ({
    id: toStr(r.workspace_id),
    name: toStr(r.workspace_name) || toStr(r.workspace_id),
    env: toStr(r.env_label),
  }));

  // Default to this deployment's own (first scanned) workspace — never a hardcoded
  // id, which would show another workspace's data (and fall back to demo fixtures).
  // Account mode while the list is still loading or only fixtures are available.
  const defaultWs = source === 'live' && workspaces[0] ? workspaces[0].id : ACCOUNT_MODE;
  const ws = params.has('ws') ? params.get('ws')! : defaultWs;

  const setWs = (next: string) => {
    const p = new URLSearchParams(params);
    p.set('ws', next);
    setParams(p, { replace: true });
  };

  return <Ctx.Provider value={{ ws, setWs, workspaces }}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
