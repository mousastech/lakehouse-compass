import type { Application, Request, Response } from 'express';
import { invokeLlm } from '../lib/dbx';

interface AppKitServer {
  server: { extend(fn: (app: Application) => void): void };
}

const SYSTEM = `You are a Databricks platform coach for a workspace administrator who may NOT know the platform deeply. Given a governance finding and its remediation, produce concise, concrete, numbered step-by-step instructions to APPLY the fix in this Databricks workspace.

Rules:
- 4 to 8 numbered steps, plain language, no fluff or preamble.
- Be specific to Databricks: exact UI paths (e.g. Settings, Compute, SQL Warehouses, Unity Catalog, Serving), SQL (GRANT/REVOKE, ALTER, tag policies), or REST/CLI where relevant.
- Read-only advice — the admin applies it; never claim you executed anything.
- Reference the rule id in one short "why it matters" line at the top.
- End with a one-line "How to verify" it worked.
- Answer in the same language as the finding title when obvious, else English.`;

/**
 * POST /api/teach — "how to apply this finding". Given a finding's context, asks
 * the governed Claude endpoint (compass-llm) for step-by-step Databricks steps.
 * Body: { domain, ruleId, title, remediation, resource }. Returns { steps }.
 */
export function setupTeachRoutes(appkit: AppKitServer): void {
  appkit.server.extend((app) => {
    app.post('/api/teach', async (req: Request, res: Response) => {
      try {
        const b = (req.body ?? {}) as Record<string, unknown>;
        const ctx = [
          `Rule id: ${b.ruleId ?? '(n/a)'}`,
          `Domain: ${b.domain ?? '(n/a)'}`,
          `Finding: ${b.title ?? '(n/a)'}`,
          `Affected resource: ${b.resource ?? '(n/a)'}`,
          `Suggested remediation: ${b.remediation ?? '(none provided)'}`,
        ].join('\n');
        const resp = await invokeLlm({
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: `How do I apply this fix in Databricks?\n\n${ctx}` },
          ],
          max_tokens: 700,
          temperature: 0.2,
        });
        const steps = resp?.choices?.[0]?.message?.content;
        if (!steps) return res.status(502).json({ error: 'no response from model' });
        return res.json({ ok: true, steps });
      } catch (e) {
        return res.status(500).json({ error: String(e).slice(0, 200) });
      }
    });
  });
}
