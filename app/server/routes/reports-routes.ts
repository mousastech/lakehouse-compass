import type { Application, Request, Response } from 'express';
import { REPORTS_PREFIX } from '../catalog';

interface AppKitServer {
  server: { extend(fn: (app: Application) => void): void };
}

function normHost(): string {
  let h = process.env.DATABRICKS_HOST || '';
  if (h && !h.startsWith('http')) h = `https://${h}`;
  return h.replace(/\/$/, '');
}

async function getSpToken(host: string): Promise<string> {
  const id = process.env.DATABRICKS_CLIENT_ID;
  const secret = process.env.DATABRICKS_CLIENT_SECRET;
  if (!id || !secret) throw new Error('service principal credentials not available');
  const r = await fetch(`${host}/oidc/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
      scope: 'all-apis',
    }),
  });
  if (!r.ok) throw new Error(`token exchange failed (${r.status})`);
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) throw new Error('no access_token in token response');
  return j.access_token;
}

async function findReportJobId(host: string, token: string): Promise<number | null> {
  const r = await fetch(`${host}/api/2.2/jobs/list?limit=100&expand_tasks=false`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { jobs?: { job_id: number; settings?: { name?: string } }[] };
  const match = (j.jobs || []).find((job) =>
    (job.settings?.name || '').includes('lakehouse-compass-report')
  );
  return match ? match.job_id : null;
}

// Only files under this Volume prefix may be streamed (no path traversal).

/**
 * POST /api/reports/generate — triggers the premium PDF report job for a
 * workspace via the Jobs API, using the app's service principal (which holds
 * CAN_MANAGE_RUN on the job). Returns the run id; the job runs async on
 * serverless and writes to the reports Volume + checkup_reports table.
 *
 * GET /api/reports/download?path=... — streams a report PDF from the reports
 * Volume through the app SP (Files API), as an application/pdf download.
 */
export function setupReportRoutes(appkit: AppKitServer): void {
  appkit.server.extend((app) => {
    app.get('/api/reports/download', async (req: Request, res: Response) => {
      try {
        const raw = typeof req.query.path === 'string' ? req.query.path : '';
        const path = decodeURIComponent(raw);
        // Validate strictly against the reports Volume prefix; reject traversal.
        if (!path.startsWith(REPORTS_PREFIX) || path.includes('..') || path.includes('\0')) {
          return res.status(400).json({ error: 'invalid path' });
        }
        const host = normHost();
        if (!host) return res.status(500).json({ error: 'DATABRICKS_HOST not set' });
        const token = await getSpToken(host);
        const fileResp = await fetch(`${host}/api/2.0/fs/files${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!fileResp.ok) {
          const tx = await fileResp.text();
          return res.status(fileResp.status === 404 ? 404 : 502).json({ error: `fetch failed (${fileResp.status}): ${tx.slice(0, 160)}` });
        }
        const buf = Buffer.from(await fileResp.arrayBuffer());
        const name = path.split('/').pop() || 'report.pdf';
        const isPdf = name.toLowerCase().endsWith('.pdf');
        res.setHeader('Content-Type', isPdf ? 'application/pdf' : 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="${name}"`);
        res.setHeader('Cache-Control', 'private, max-age=60');
        return res.send(buf);
      } catch (e) {
        return res.status(500).json({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
      }
    });

    app.post('/api/reports/generate', async (req: Request, res: Response) => {
      try {
        const body = (req.body || {}) as { workspace_id?: string; scan_id?: string };
        const host = normHost();
        if (!host) return res.status(500).json({ error: 'DATABRICKS_HOST not set' });
        const token = await getSpToken(host);
        const jobId = await findReportJobId(host, token);
        if (!jobId) return res.status(404).json({ error: 'report job not found' });

        const runResp = await fetch(`${host}/api/2.2/jobs/run-now`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id: jobId,
            job_parameters: {
              workspace_id: body.workspace_id || '',
              scan_id: body.scan_id || '',
            },
          }),
        });
        if (!runResp.ok) {
          const tx = await runResp.text();
          return res.status(502).json({ error: `run-now failed (${runResp.status}): ${tx.slice(0, 200)}` });
        }
        const run = (await runResp.json()) as { run_id?: number };
        return res.json({ ok: true, run_id: run.run_id, job_id: jobId });
      } catch (e) {
        return res.status(500).json({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
      }
    });
  });
}
