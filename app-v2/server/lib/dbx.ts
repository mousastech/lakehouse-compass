// Server-side Databricks helpers shared by the report + agent routes.
// Uses the app service principal's OAuth (client_credentials) for the Jobs API,
// the SQL Statements API (read-only Compass Delta), and the governed serving
// endpoint. Never forwards user tokens to the browser.

export function normHost(): string {
  let h = process.env.DATABRICKS_HOST || '';
  if (h && !h.startsWith('http')) h = `https://${h}`;
  return h.replace(/\/$/, '');
}

let cachedToken: { token: string; exp: number } | null = null;

export async function getSpToken(host = normHost()): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.exp) return cachedToken.token;
  const id = process.env.DATABRICKS_CLIENT_ID;
  const secret = process.env.DATABRICKS_CLIENT_SECRET;
  if (!id || !secret) throw new Error('service principal credentials not available');
  const r = await fetch(`${host}/oidc/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'all-apis' }),
  });
  if (!r.ok) throw new Error(`token exchange failed (${r.status})`);
  const j = (await r.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error('no access_token');
  cachedToken = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000 };
  return j.access_token;
}

const WAREHOUSE = () => process.env.DATABRICKS_WAREHOUSE_ID || '';

/** Execute read-only SQL via the Statements API; returns object rows. */
export async function runSql(statement: string): Promise<Record<string, unknown>[]> {
  const host = normHost();
  const token = await getSpToken(host);
  const post = await fetch(`${host}/api/2.0/sql/statements`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ warehouse_id: WAREHOUSE(), statement, wait_timeout: '30s' }),
  });
  if (!post.ok) throw new Error(`sql failed (${post.status}): ${(await post.text()).slice(0, 160)}`);
  let body = (await post.json()) as any;
  // Poll if still running.
  for (let i = 0; i < 20 && body?.status?.state && !['SUCCEEDED', 'FAILED', 'CANCELED'].includes(body.status.state); i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const g = await fetch(`${host}/api/2.0/sql/statements/${body.statement_id}`, { headers: { Authorization: `Bearer ${token}` } });
    body = await g.json();
  }
  if (body?.status?.state !== 'SUCCEEDED') {
    throw new Error(`sql state ${body?.status?.state}: ${body?.status?.error?.message || ''}`.slice(0, 200));
  }
  const cols: string[] = (body.manifest?.schema?.columns || []).map((c: any) => c.name);
  const data: unknown[][] = body.result?.data_array || [];
  return data.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

export async function invokeLlm(payload: Record<string, unknown>): Promise<any> {
  const host = normHost();
  const token = await getSpToken(host);
  const name = process.env.COMPASS_LLM_ENDPOINT || 'databricks-claude-sonnet-4-5';
  const r = await fetch(`${host}/serving-endpoints/${name}/invocations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`llm invoke failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export interface Governance {
  endpoint: string;
  usage_tracking: boolean;
  payload_logging: boolean;
  guardrails: boolean;
  rate_limits: boolean;
  fully_governed: boolean;
  ready: boolean;
}

export async function getGovernance(): Promise<Governance> {
  const host = normHost();
  const token = await getSpToken(host);
  const name = process.env.COMPASS_LLM_ENDPOINT || 'databricks-claude-sonnet-4-5';
  const r = await fetch(`${host}/api/2.0/serving-endpoints/${name}`, { headers: { Authorization: `Bearer ${token}` } });
  const d = (await r.json()) as any;
  const g = d.ai_gateway || {};
  const usage = !!g.usage_tracking_config?.enabled;
  const payload = !!(g.inference_table_config?.enabled);
  const guardrails = !!(g.guardrails && (g.guardrails.input || g.guardrails.output));
  const rate = Array.isArray(g.rate_limits) && g.rate_limits.length > 0;
  return {
    endpoint: name,
    usage_tracking: usage,
    payload_logging: payload,
    guardrails,
    rate_limits: rate,
    fully_governed: usage && payload && guardrails,
    ready: d.state?.ready === 'READY',
  };
}
