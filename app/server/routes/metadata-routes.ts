import type { Application, Request, Response } from 'express';
import { runSql, type SqlParam } from '../lib/dbx';
import { CAT } from '../catalog';
import { userCanManage, userEmail } from '../agent/agent-routes';
import { PROMPT_VERSION, judgeAll, runEval, type JudgeItem } from '../metadata/judge';

interface AppKitServer {
  server: { extend(fn: (app: Application) => void): void };
}

const MAX_REVIEW = 200;
const DEFAULT_REVIEW = 36; // 3 batches → one parallel wave on the endpoint
const MAX_PROPOSE = 50;

function wsParam(v: unknown): string {
  return typeof v === 'string' && /^[0-9]+$/.test(v) ? v : '';
}

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

const q = (id: string) => '`' + id.replace(/`/g, '``') + '`';

/** Databricks SQL string literal (backslash escapes), for the *proposed* DDL text only. */
function sqlLiteral(s: string): string {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

async function requireManager(req: Request, res: Response): Promise<boolean> {
  const who = userEmail(req);
  if (await userCanManage(who)) return true;
  res.status(403).json({ error: `Running the LLM review needs CAN MANAGE on the Compass app (it spends tokens on the governed endpoint). ${who} does not have it.` });
  return false;
}

export function setupMetadataRoutes(appkit: AppKitServer): void {
  appkit.server.extend((app) => {
    // Judge the highest-priority column descriptions not yet reviewed with the
    // current prompt version. Candidates come from the latest scan (the app SP
    // cannot read other catalogs' information_schema). Writes reviews only.
    app.post('/api/metadata/review', async (req: Request, res: Response) => {
      try {
        const body = (req.body || {}) as { ws?: string; limit?: number };
        const ws = wsParam(body.ws);
        if (!ws) {
          res.status(400).json({ error: 'ws (workspace id) required' });
          return;
        }
        if (!(await requireManager(req, res))) return;
        const limit = Math.min(MAX_REVIEW, Math.max(1, Math.round(Number(body.limit) || DEFAULT_REVIEW)));

        const rows = await runSql(
          `WITH latest AS (SELECT MAX(scan_id) AS scan_id FROM ${CAT}.metadata_candidates WHERE workspace_id = :ws)
           SELECT c.catalog, c.\`schema\`, c.\`table\`, c.\`column\`, c.data_type, c.comment, c.table_comment, c.comment_hash
           FROM ${CAT}.metadata_candidates c JOIN latest l ON c.scan_id = l.scan_id
           WHERE c.workspace_id = :ws
             AND NOT EXISTS (SELECT 1 FROM ${CAT}.metadata_llm_reviews r
                             WHERE r.comment_hash = c.comment_hash AND r.prompt_version = :pv AND r.workspace_id = :ws)
           ORDER BY c.priority DESC, c.catalog, c.\`table\`, c.\`column\`
           LIMIT ${limit}`,
          [{ name: 'ws', value: ws }, { name: 'pv', value: PROMPT_VERSION }]
        );
        if (!rows.length) {
          res.json({ reviewed: 0, note: 'Nothing new to review: every candidate from the latest scan already has a review for this prompt version.' });
          return;
        }
        const items: (JudgeItem & { row: Record<string, unknown> })[] = rows.map((r, i) => ({
          id: `c${i}`,
          fq: `${r.catalog}.${r.schema}.${r.table}.${r.column}`,
          data_type: String(r.data_type ?? ''),
          comment: String(r.comment ?? ''),
          table_comment: String(r.table_comment ?? ''),
          row: r,
        }));
        const { verdicts, model, errors } = await judgeAll(items);
        const byId = new Map(items.map((i) => [i.id, i]));
        const who = userEmail(req);
        const now = new Date().toISOString();

        // One parameterized INSERT per chunk — catalog text never touches the SQL string.
        const COLS = ['review_id', 'workspace_id', 'catalog', 'schema', 'table', 'column', 'comment_hash', 'comment', 'verdict',
          'specificity', 'business_semantics', 'plausibility', 'genie_usefulness', 'score', 'reason', 'suggestion', 'model',
          'prompt_version', 'reviewed_by', 'reviewed_at'];
        const INT = new Set(['specificity', 'business_semantics', 'plausibility', 'genie_usefulness']);
        for (let i = 0; i < verdicts.length; i += 10) {
          const chunk = verdicts.slice(i, i + 10);
          const params: SqlParam[] = [];
          const tuples = chunk.map((v, k) => {
            const it = byId.get(v.id)!;
            const r = it.row;
            const vals: Record<string, string | null> = {
              review_id: `rv-${Date.now()}-${i + k}`, workspace_id: ws, catalog: String(r.catalog), schema: String(r.schema),
              table: String(r.table), column: String(r.column), comment_hash: String(r.comment_hash), comment: it.comment,
              verdict: v.verdict, specificity: String(v.specificity), business_semantics: String(v.business_semantics),
              plausibility: String(v.plausibility), genie_usefulness: String(v.genie_usefulness), score: String(v.score),
              reason: v.reason, suggestion: v.suggestion, model, prompt_version: PROMPT_VERSION, reviewed_by: who, reviewed_at: now,
            };
            return '(' + COLS.map((c) => {
              const name = `p${i + k}_${c}`;
              params.push({ name, value: vals[c], type: INT.has(c) ? 'INT' : c === 'score' ? 'DOUBLE' : 'STRING' });
              return `:${name}`;
            }).join(', ') + ')';
          });
          await runSql(`INSERT INTO ${CAT}.metadata_llm_reviews (${COLS.map(q).join(', ')}) VALUES ${tuples.join(', ')}`, params);
        }
        const counts = { good: 0, weak: 0, poor: 0 } as Record<string, number>;
        for (const v of verdicts) counts[v.verdict] += 1;
        res.json({ reviewed: verdicts.length, requested: items.length, verdicts: counts, model, prompt_version: PROMPT_VERSION, errors });
      } catch (e) {
        res.status(500).json({ error: errMsg(e) });
      }
    });

    // Turn reviewed suggestions into ProposedChanges (GOV-041) for human approval
    // on the Changes screen. Drafting never executes anything.
    app.post('/api/metadata/propose', async (req: Request, res: Response) => {
      try {
        const body = (req.body || {}) as { ws?: string; review_ids?: unknown };
        const ws = wsParam(body.ws);
        const ids = (Array.isArray(body.review_ids) ? body.review_ids : [])
          .map(String).filter((s) => /^rv-[0-9]+-[0-9]+$/.test(s)).slice(0, MAX_PROPOSE);
        if (!ws || !ids.length) {
          res.status(400).json({ error: 'ws and review_ids required' });
          return;
        }
        const params: SqlParam[] = [{ name: 'ws', value: ws }, ...ids.map((v, i) => ({ name: `id${i}`, value: v }))];
        const rows = await runSql(
          `SELECT review_id, catalog, \`schema\`, \`table\`, \`column\`, comment, suggestion, verdict, reason
           FROM ${CAT}.metadata_llm_reviews
           WHERE workspace_id = :ws AND review_id IN (${ids.map((_, i) => `:id${i}`).join(', ')})
             AND suggestion IS NOT NULL AND suggestion <> ''`,
          params
        );
        const who = userEmail(req);
        const created: string[] = [];
        for (const [n, r] of rows.entries()) {
          const target = `${q(String(r.catalog))}.${q(String(r.schema))}.${q(String(r.table))}`;
          const col = q(String(r.column));
          const fq = `${r.catalog}.${r.schema}.${r.table}.${r.column}`;
          const changeId = `pc-${Date.now()}${n}`;
          const vals: Record<string, string | null> = {
            change_id: changeId,
            finding_id: String(r.review_id),
            rule_id: 'GOV-041',
            workspace_id: ws,
            title: `Rewrite the description of ${fq}`,
            steps: `1. Check the suggested description against the column's real meaning (the LLM only saw names, types and the current text). 2. Edit it if needed and run the statement. 3. Re-run the Compass scan. Judge reason (${r.verdict}): ${r.reason}`,
            code: `ALTER TABLE ${target} ALTER COLUMN ${col} COMMENT ${sqlLiteral(String(r.suggestion))};`,
            rollback: `ALTER TABLE ${target} ALTER COLUMN ${col} COMMENT ${sqlLiteral(String(r.comment ?? ''))};`,
            blast_radius: 'Low — metadata only (column comment)',
            confidence: 'MEDIUM',
            status: 'NEEDS_INFO',
            created_by: who,
            created_at: new Date().toISOString(),
          };
          const cols = Object.keys(vals);
          await runSql(
            `INSERT INTO ${CAT}.proposed_changes (${cols.join(', ')}, decided_by, decided_at) VALUES (${cols.map((c) => `:${c}`).join(', ')}, NULL, NULL)`,
            cols.map((c) => ({ name: c, value: vals[c] }))
          );
          created.push(changeId);
        }
        res.json({ proposed: created.length, change_ids: created, note: 'Drafts stored for approval on the Changes screen — Compass never executes them.' });
      } catch (e) {
        res.status(500).json({ error: errMsg(e) });
      }
    });

    // Latest review per still-current comment (hash in the latest scan's candidates).
    app.get('/api/metadata/reviews', async (req: Request, res: Response) => {
      try {
        const ws = wsParam(req.query.ws);
        if (!ws) {
          res.json([]);
          return;
        }
        const rows = await runSql(
          `WITH latest AS (SELECT MAX(scan_id) AS scan_id FROM ${CAT}.metadata_candidates WHERE workspace_id = :ws),
                cur AS (SELECT c.comment_hash, c.priority FROM ${CAT}.metadata_candidates c JOIN latest l ON c.scan_id = l.scan_id
                        WHERE c.workspace_id = :ws),
                rv AS (SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.comment_hash ORDER BY r.reviewed_at DESC) AS rk
                       FROM ${CAT}.metadata_llm_reviews r WHERE r.workspace_id = :ws)
           SELECT rv.review_id, rv.catalog, rv.\`schema\`, rv.\`table\`, rv.\`column\`, rv.comment, rv.verdict, rv.score,
                  rv.specificity, rv.business_semantics, rv.plausibility, rv.genie_usefulness, rv.reason, rv.suggestion,
                  rv.model, rv.prompt_version, rv.reviewed_at, cur.priority
           FROM rv JOIN cur ON cur.comment_hash = rv.comment_hash
           WHERE rv.rk = 1
           ORDER BY CASE rv.verdict WHEN 'poor' THEN 0 WHEN 'weak' THEN 1 ELSE 2 END, cur.priority DESC
           LIMIT 300`,
          [{ name: 'ws', value: ws }]
        );
        const pending = await runSql(
          `WITH latest AS (SELECT MAX(scan_id) AS scan_id FROM ${CAT}.metadata_candidates WHERE workspace_id = :ws)
           SELECT COUNT(*) AS n FROM ${CAT}.metadata_candidates c JOIN latest l ON c.scan_id = l.scan_id
           WHERE c.workspace_id = :ws AND NOT EXISTS (SELECT 1 FROM ${CAT}.metadata_llm_reviews r
             WHERE r.comment_hash = c.comment_hash AND r.prompt_version = :pv AND r.workspace_id = :ws)`,
          [{ name: 'ws', value: ws }, { name: 'pv', value: PROMPT_VERSION }]
        );
        res.json({ reviews: rows, pending: Number(pending[0]?.n ?? 0), prompt_version: PROMPT_VERSION });
      } catch (e) {
        // Tables absent before the first Phase-3 scan → empty, not an error page.
        res.json({ reviews: [], pending: 0, prompt_version: PROMPT_VERSION, error: errMsg(e) });
      }
    });

    // Agreement of the judge with the hand-labelled seed eval set (no writes).
    app.post('/api/metadata/eval', async (req: Request, res: Response) => {
      try {
        if (!(await requireManager(req, res))) return;
        res.json(await runEval());
      } catch (e) {
        res.status(500).json({ error: errMsg(e) });
      }
    });
  });
}
