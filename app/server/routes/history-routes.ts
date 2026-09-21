import type { Application, Request, Response } from 'express';
import { runSql } from '../lib/dbx';

interface AppKitServer {
  server: { extend(fn: (app: Application) => void): void };
}

const CAT = 'moi_ai_catalog.lakehouse_compass';
const SCAN_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * GET /api/history/diff?ws=&a=<newer_scan>&b=<older_scan>
 *
 * Scan-diff between two scans, computed server-side so the UI does not
 * reimplement it. Semantics match packages/compass_core/diff.py (used by the
 * report job): new = in A not B, resolved = in B not A, regressed = in both.
 * Compared by rule_id; returns finding details for the drawer.
 */
export function setupHistoryRoutes(appkit: AppKitServer): void {
  appkit.server.extend((app) => {
    app.get('/api/history/diff', async (req: Request, res: Response) => {
      try {
        const ws = typeof req.query.ws === 'string' && /^[0-9]+$/.test(req.query.ws) ? req.query.ws : '';
        const a = String(req.query.a || '');
        const b = String(req.query.b || '');
        if (!SCAN_ID.test(a) || !SCAN_ID.test(b)) {
          res.status(400).json({ error: 'invalid scan id' });
          return;
        }
        const wsc = ws ? `AND workspace_id='${ws}'` : '';
        const q = (scan: string) =>
          `SELECT DISTINCT rule_id, domain, severity, title, resource, evidence_json, remediation, framework_controls, self_check
           FROM ${CAT}.findings WHERE scan_id='${scan}' ${wsc}`;
        const [cur, prev] = await Promise.all([runSql(q(a)), runSql(q(b))]);
        const curIds = new Set(cur.map((r) => String(r.rule_id)));
        const prevIds = new Set(prev.map((r) => String(r.rule_id)));
        res.json({
          a,
          b,
          new: cur.filter((r) => !prevIds.has(String(r.rule_id))),
          resolved: prev.filter((r) => !curIds.has(String(r.rule_id))),
          regressed: cur.filter((r) => prevIds.has(String(r.rule_id))),
        });
      } catch (e) {
        res.status(500).json({ error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
      }
    });
  });
}
