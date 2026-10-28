// Compass administrators. Admins can run the LLM description review / eval and
// approve or reject ProposedChanges.
//
// Effective admins = users holding CAN MANAGE on the app (the bootstrap: whoever
// manages the app in Databricks) ∪ users registered in Compass Settings. The
// registry is an append-only log (${CAT}.app_admins: email, action ADD|REMOVE,
// actor, at) — the latest action per email wins, so every grant and revocation
// stays auditable. The scan job creates the table and grants the app SP
// SELECT + MODIFY on it.
import { CAT } from '../catalog';
import { getSpToken, normHost, runSql } from './dbx';

export interface RegisteredAdmin { email: string; added_by: string; added_at: string }
export interface AdminList {
  managers: string[]; // CAN MANAGE on the app (manage in the app's permissions)
  manager_groups: string[]; // groups with CAN MANAGE — shown, not expanded
  registered: RegisteredAdmin[];
  registry_ready: boolean; // false until the scan has created app_admins
}

const EMAIL = /^[^\s@'"`\\]+@[^\s@'"`\\]+\.[^\s@'"`\\]+$/;
export const normEmail = (s: unknown): string => String(s ?? '').trim().toLowerCase();
export const validEmail = (s: string): boolean => EMAIL.test(s) && s.length <= 254;

let aclCache: { at: number; managers: string[]; groups: string[] } | null = null;

/** Users and groups with CAN MANAGE on the app (cached 60 s). Needs the app SP to hold CAN MANAGE on the app. */
async function appManagers(): Promise<{ managers: string[]; groups: string[] }> {
  if (aclCache && Date.now() - aclCache.at < 60_000) return aclCache;
  const host = normHost();
  const token = await getSpToken(host);
  const app = process.env.DATABRICKS_APP_NAME || 'lakehouse-compass';
  const r = await fetch(`${host}/api/2.0/permissions/apps/${encodeURIComponent(app)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`app permissions not readable (${r.status}) — grant the app service principal CAN MANAGE on the app`);
  const d = (await r.json()) as { access_control_list?: { user_name?: string; group_name?: string; all_permissions?: { permission_level?: string }[] }[] };
  const managers: string[] = [];
  const groups: string[] = [];
  for (const a of d.access_control_list || []) {
    if (!(a.all_permissions || []).some((p) => p.permission_level === 'CAN_MANAGE')) continue;
    if (a.user_name) managers.push(normEmail(a.user_name));
    else if (a.group_name) groups.push(a.group_name);
  }
  aclCache = { at: Date.now(), managers: managers.sort(), groups: groups.sort() };
  return aclCache;
}

async function registered(): Promise<{ list: RegisteredAdmin[]; ready: boolean }> {
  try {
    const rows = await runSql(
      `SELECT email, actor, at FROM (
         SELECT email, action, actor, at, ROW_NUMBER() OVER (PARTITION BY email ORDER BY at DESC) AS rk
         FROM ${CAT}.app_admins) WHERE rk = 1 AND action = 'ADD' ORDER BY email`
    );
    return { list: rows.map((r) => ({ email: String(r.email), added_by: String(r.actor ?? ''), added_at: String(r.at ?? '') })), ready: true };
  } catch {
    return { list: [], ready: false }; // table not created yet → only app managers are admins
  }
}

export async function listAdmins(): Promise<AdminList> {
  const [acl, reg] = await Promise.all([appManagers().catch(() => ({ managers: [], groups: [] })), registered()]);
  return { managers: acl.managers, manager_groups: acl.groups, registered: reg.list, registry_ready: reg.ready };
}

export async function isAdmin(email: string): Promise<boolean> {
  const e = normEmail(email);
  if (!validEmail(e)) return false;
  const a = await listAdmins();
  return a.managers.includes(e) || a.registered.some((r) => r.email === e);
}

/** Append an ADD/REMOVE entry (parameterized — the email never touches the SQL text). */
export async function recordAdmin(action: 'ADD' | 'REMOVE', email: string, actor: string): Promise<void> {
  await runSql(`INSERT INTO ${CAT}.app_admins (email, action, actor, at) VALUES (:email, :action, :actor, :at)`, [
    { name: 'email', value: normEmail(email) },
    { name: 'action', value: action },
    { name: 'actor', value: normEmail(actor) },
    { name: 'at', value: new Date().toISOString() },
  ]);
}
