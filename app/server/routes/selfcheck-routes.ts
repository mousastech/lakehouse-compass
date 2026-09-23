import type { Application, Request, Response } from 'express';
import { runSql, getGovernance } from '../lib/dbx';

interface AppKitServer {
  server: { extend(fn: (app: Application) => void): void };
}

import { CAT } from '../catalog';
// The app's own service principal — Databricks Apps expose it as DATABRICKS_CLIENT_ID;
// COMPASS_APP_SP overrides, and the fevm SP is the last-resort default.
const APP_SP = process.env.COMPASS_APP_SP || process.env.DATABRICKS_CLIENT_ID || '9e5eaa76-9282-4a5a-be66-41397adf8313';

interface SelfCheckItem {
  id: string;
  rule_id: string;
  title: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  severity: string;
  detail: string;
}

/**
 * GET /api/selfcheck — runs Compass's rules against Compass's own resources
 * (spec §2.12/§14): the compass-llm endpoint governance (AIG-004), the app
 * service principal's grants (SEC-031/SEC-027), scan freshness (MNT-010), and
 * its own catalog/schema. "Compass eats its own cooking."
 */
export function setupSelfCheckRoutes(appkit: AppKitServer): void {
  appkit.server.extend((app) => {
    app.get('/api/selfcheck', async (_req: Request, res: Response) => {
      const items: SelfCheckItem[] = [];

      // 1) Endpoint governance — AIG-004 self-check.
      try {
        const g = await getGovernance();
        items.push({
          id: 'self-AIG-004',
          rule_id: 'AIG-004',
          title: `Agent endpoint governance (${g.endpoint})`,
          status: g.fully_governed ? 'PASS' : 'WARN',
          severity: 'high',
          detail: `usage_tracking=${g.usage_tracking}, guardrails=${g.guardrails}, payload_logging=${g.payload_logging}. ${g.fully_governed ? 'Fully governed.' : 'Add guardrails + inference tables + a spend cap for production.'}`,
        });
      } catch (e) {
        items.push({ id: 'self-AIG-004', rule_id: 'AIG-004', title: 'Agent endpoint governance', status: 'WARN', severity: 'high', detail: `could not read endpoint config: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` });
      }

      // 2) App service principal grants — SEC-031 / SEC-027.
      try {
        const rows = await runSql(
          `SELECT 'catalog' AS scope, privilege_type, COUNT(*) AS n FROM system.information_schema.catalog_privileges WHERE grantee='${APP_SP}' GROUP BY privilege_type
           UNION ALL
           SELECT 'schema', privilege_type, COUNT(*) FROM system.information_schema.schema_privileges WHERE grantee='${APP_SP}' GROUP BY privilege_type`
        );
        const broad = rows.filter((r) => ['ALL_PRIVILEGES', 'MODIFY', 'MANAGE'].includes(String(r.privilege_type)));
        const summary = rows.map((r) => `${r.scope}:${r.privilege_type}×${r.n}`).join(', ') || 'no grants';
        items.push({
          id: 'self-SEC-031',
          rule_id: broad.length ? 'SEC-027' : 'SEC-031',
          title: 'App service principal least-privilege',
          status: broad.length ? 'FAIL' : 'PASS',
          severity: broad.length ? 'critical' : 'info',
          detail: broad.length ? `SP holds broad privileges: ${summary}` : `Least-privilege OK — ${summary}.`,
        });
      } catch (e) {
        items.push({ id: 'self-SEC-031', rule_id: 'SEC-031', title: 'App service principal least-privilege', status: 'WARN', severity: 'info', detail: `could not read grants: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` });
      }

      // 3) Scan freshness — MNT-010.
      try {
        const rows = await runSql(`SELECT MAX(generated_at) AS last FROM ${CAT}.scan_runs`);
        const last = rows[0]?.last ? String(rows[0].last) : '';
        const ageDays = last ? (Date.now() - new Date(last).getTime()) / 86_400_000 : 999;
        items.push({
          id: 'self-MNT-010',
          rule_id: 'MNT-010',
          title: 'Compass scan freshness',
          status: ageDays <= 7 ? 'PASS' : 'FAIL',
          severity: 'medium',
          detail: last ? `Last scan ${last} (${ageDays.toFixed(1)} days ago).` : 'No scan has run yet.',
        });
      } catch (e) {
        items.push({ id: 'self-MNT-010', rule_id: 'MNT-010', title: 'Compass scan freshness', status: 'WARN', severity: 'medium', detail: `could not read scan_runs: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` });
      }

      // 4) Own catalog/schema reachable.
      try {
        await runSql(`SELECT 1 FROM ${CAT}.findings LIMIT 1`);
        items.push({ id: 'self-store', rule_id: '—', title: 'Compass catalog/schema reachable', status: 'PASS', severity: 'info', detail: `${CAT}.* is readable by the app service principal.` });
      } catch (e) {
        items.push({ id: 'self-store', rule_id: '—', title: 'Compass catalog/schema reachable', status: 'FAIL', severity: 'high', detail: `cannot read ${CAT}: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` });
      }

      res.json(items);
    });
  });
}
