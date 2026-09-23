import type { Application, Request, Response } from 'express';

interface AppKitServer {
  server: { extend(fn: (app: Application) => void): void };
}

function normHost(): string {
  let h = process.env.DATABRICKS_HOST || '';
  if (h && !h.startsWith('http')) h = `https://${h}`;
  return h.replace(/\/$/, '');
}

// Client-credentials token for the app's own service principal.
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

async function findScanJobId(host: string, token: string): Promise<number | null> {
  const r = await fetch(`${host}/api/2.2/jobs/list?limit=100&expand_tasks=false`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { jobs?: { job_id: number; settings?: { name?: string } }[] };
  // The scan job name contains "lakehouse-compass-scan"; report/digest names differ.
  const match = (j.jobs || []).find((job) =>
    (job.settings?.name || '').includes('lakehouse-compass-scan')
  );
  return match ? match.job_id : null;
}

/**
 * POST /api/scan/run — triggers the compass_scan job on demand (the app SP has
 * CAN_MANAGE_RUN on it). Returns the run id; the scan runs async on serverless
 * and lands its Delta tables in a couple of minutes. No request body needed —
 * the job carries its own workspace/catalog task parameters.
 */
export function setupScanRoutes(appkit: AppKitServer): void {
  appkit.server.extend((app) => {
    app.post('/api/scan/run', async (_req: Request, res: Response) => {
      try {
        const host = normHost();
        if (!host) return res.status(500).json({ error: 'DATABRICKS_HOST not set' });
        const token = await getSpToken(host);
        const jobId = await findScanJobId(host, token);
        if (!jobId) return res.status(404).json({ error: 'scan job not found' });

        const runResp = await fetch(`${host}/api/2.2/jobs/run-now`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: jobId }),
        });
        if (!runResp.ok) {
          const tx = await runResp.text();
          return res.status(502).json({ error: `run-now failed (${runResp.status}): ${tx.slice(0, 160)}` });
        }
        const run = (await runResp.json()) as { run_id?: number };
        return res.json({ ok: true, run_id: run.run_id, job_id: jobId });
      } catch (e) {
        return res.status(500).json({ error: String(e).slice(0, 200) });
      }
    });
  });
}
