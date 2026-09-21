import { createContext, useContext, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useLiveRows } from './analytics';
import { toStr } from './rows';

// Current workspace (this deployment). Default selection.
export const CURRENT_WS = '7474658545709121';
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
  const ws = params.has('ws') ? params.get('ws')! : CURRENT_WS;

  const setWs = (next: string) => {
    const p = new URLSearchParams(params);
    p.set('ws', next);
    setParams(p, { replace: true });
  };

  // Discovered/scanned workspaces (fixture fallback = current only).
  const { rows } = useLiveRows('workspaces', '/api/rows/workspaces');
  const workspaces: WorkspaceOption[] = rows.map((r) => ({
    id: toStr(r.workspace_id),
    name: toStr(r.workspace_name) || toStr(r.workspace_id),
    env: toStr(r.env_label),
  }));

  return <Ctx.Provider value={{ ws, setWs, workspaces }}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
