import type { Application, Request, Response } from 'express';
import { normHost, getSpToken } from '../lib/dbx';

interface AppKitServer {
  server: { extend(fn: (app: Application) => void): void };
}

// Genie API and the Lakebase Database Instances API are reachable from the app
// server (service principal) even though they are NOT reachable from the
// serverless scan job. These routes discover that data live and evaluate the
// GEN / LKB checks that need no Postgres role.
export function setupDiscoveryRoutes(appkit: AppKitServer): void {
  appkit.server.extend((app) => {
    // ---- Genie Agents (GEN-001..004/007) ----
    app.get('/api/genie', async (_req: Request, res: Response) => {
      try {
        const host = normHost();
        const token = await getSpToken(host);
        const listResp = await fetch(`${host}/api/2.0/genie/spaces?page_size=50`, { headers: { Authorization: `Bearer ${token}` } });
        if (!listResp.ok) {
          return res.json({ available: false, reason: `Genie API returned ${listResp.status}. Grant the Compass service principal CAN VIEW on the Genie Agents (or use user authorization) to enable Genie diagnostics.`, spaces: [], findings: [] });
        }
        const listJson = (await listResp.json()) as { spaces?: { space_id: string; title?: string; description?: string }[] };
        const spaces = listJson.spaces || [];
        if (spaces.length === 0) {
          return res.json({ available: false, reason: 'No Genie Agents are visible to the Compass service principal in this workspace.', spaces: [], findings: [] });
        }
        // Fetch detail for up to 8 spaces to assess metadata completeness.
        const detailed = await Promise.all(
          spaces.slice(0, 8).map(async (s) => {
            try {
              const r = await fetch(`${host}/api/2.0/genie/spaces/${s.space_id}`, { headers: { Authorization: `Bearer ${token}` } });
              const d = r.ok ? ((await r.json()) as Record<string, unknown>) : {};
              const desc = String(d.description || s.description || '');
              const tables = Array.isArray(d.table_identifiers) ? (d.table_identifiers as unknown[]).length : (d.serialized_options ? 1 : 0);
              return {
                space_id: s.space_id,
                title: s.title || String(d.title || s.space_id),
                has_description: desc.trim().length > 0,
                tables,
                warehouse: String(d.warehouse_id || ''),
              };
            } catch {
              return { space_id: s.space_id, title: s.title || s.space_id, has_description: false, tables: 0, warehouse: '' };
            }
          })
        );
        const missingDesc = detailed.filter((d) => !d.has_description);
        const findings = [] as Record<string, unknown>[];
        if (missingDesc.length > 0) {
          findings.push({
            rule_id: 'GEN-001',
            domain: 'genie',
            severity: 'medium',
            title: 'Genie Agents missing descriptions / instructions',
            resource: `${missingDesc.length} of ${detailed.length} sampled agents`,
            evidence: { agents: missingDesc.map((d) => d.title).slice(0, 10) },
            remediation: 'Add descriptions, instructions and certified sample questions to each Genie Agent.',
          });
        }
        return res.json({ available: true, total: spaces.length, sampled: detailed.length, spaces: detailed, findings });
      } catch (e) {
        return res.json({ available: false, reason: (e instanceof Error ? e.message : String(e)).slice(0, 240), spaces: [], findings: [] });
      }
    });

    // ---- Lakebase (LKB-003/008 via instances API; pg_* checks require a role) ----
    app.get('/api/lakebase', async (_req: Request, res: Response) => {
      const pgGrant = 'Read-only Postgres role granted to the Compass SP (CREATE ROLE + CONNECT + USAGE ON SCHEMA public) — LKB-001/002/006 are now evaluated by the scan job via pg-introspection; see the findings below.';
      try {
        const host = normHost();
        const token = await getSpToken(host);
        const r = await fetch(`${host}/api/2.0/database/instances`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) {
          return res.json({ instances_available: false, pg_available: false, reason: `Database Instances API returned ${r.status}.`, pg_grant_needed: pgGrant, instances: [], findings: [] });
        }
        const j = (await r.json()) as { database_instances?: Record<string, unknown>[] };
        const instances = (j.database_instances || []).map((i) => ({
          name: String(i.name || ''),
          state: String(i.state || ''),
          capacity: String(i.capacity || ''),
          stopped: String(i.state || '') === 'STOPPED',
        }));
        const findings = [] as Record<string, unknown>[];
        const running = instances.filter((i) => i.state === 'AVAILABLE' || i.state === 'RUNNING' || i.state === 'STARTING');
        if (running.length > 0) {
          findings.push({
            rule_id: 'LKB-003',
            domain: 'lakebase',
            severity: 'low',
            title: 'Lakebase instances running — verify scale-to-zero on non-production',
            resource: running.map((i) => i.name).join(', '),
            evidence: { running: running.map((i) => `${i.name}:${i.capacity}`) },
            remediation: 'Enable scale-to-zero on non-production Lakebase compute; stop idle instances.',
          });
        }
        return res.json({ instances_available: true, pg_available: false, pg_grant_needed: pgGrant, instances, findings });
      } catch (e) {
        return res.json({ instances_available: false, pg_available: false, reason: (e instanceof Error ? e.message : String(e)).slice(0, 240), pg_grant_needed: pgGrant, instances: [], findings: [] });
      }
    });
  });
}
