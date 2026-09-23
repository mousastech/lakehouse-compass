import type { Application, Request, Response } from 'express';
import { meta } from '../demo/fixtures';
import {
  scoresRows,
  findingsRows,
  costSummaryRows,
  costDetailRows,
  complianceRows,
  maintenanceRows,
  workspacesRows,
  trendRows,
  reportsRows,
  aiEstateRows,
  governanceMetricsRows,
  perfSummaryRows,
  usageSummaryRows,
  usageHeatmapRows,
  usageActiveUsersTrendRows,
  reliabilitySummaryRows,
  wafScoresRows,
  wafControlsRows,
  digestsRows,
  genieReadinessRows,
  genieReadinessPillarsRows,
  genieCostSummaryRows,
  genieCostByUserRows,
} from '../demo/dbrows';

// AppKit's server plugin exposes `extend` to register extra Express routes.
interface AppKitServer {
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const DEMO_MODE = process.env.COMPASS_DEMO_MODE === 'true';

/**
 * Read-only fallback API. The client reads live Delta via the analytics plugin
 * (config/queries/*.sql); when a table is empty/absent it falls back to these
 * endpoints, which return rows shaped exactly like the Delta output.
 */
export function setupApiRoutes(appkit: AppKitServer): void {
  appkit.server.extend((app) => {
    app.get('/api/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', demoMode: DEMO_MODE, ts: new Date().toISOString() });
    });

    app.get('/api/meta', (_req: Request, res: Response) => {
      res.json({ ...meta, demoMode: DEMO_MODE });
    });

    // DB-shaped fallback rows (match config/queries/*.sql output).
    app.get('/api/rows/scores', (_req, res) => res.json(scoresRows));
    app.get('/api/rows/waf_scores', (_req, res) => res.json(wafScoresRows));
    app.get('/api/rows/waf_controls', (_req, res) => res.json(wafControlsRows));
    app.get('/api/rows/digests', (_req, res) => res.json(digestsRows));
    app.get('/api/rows/findings', (_req, res) => res.json(findingsRows));
    app.get('/api/rows/cost_summary', (_req, res) => res.json(costSummaryRows));
    app.get('/api/rows/cost_detail', (_req, res) => res.json(costDetailRows));
    app.get('/api/rows/compliance', (_req, res) => res.json(complianceRows));
    app.get('/api/rows/maintenance', (_req, res) => res.json(maintenanceRows));
    app.get('/api/rows/workspaces', (_req, res) => res.json(workspacesRows));
    app.get('/api/rows/trend', (_req, res) => res.json(trendRows));
    app.get('/api/rows/reports', (_req, res) => res.json(reportsRows));
    app.get('/api/rows/ai_estate', (_req, res) => res.json(aiEstateRows));
    app.get('/api/rows/governance_metrics', (_req, res) => res.json(governanceMetricsRows));
    app.get('/api/rows/perf_summary', (_req, res) => res.json(perfSummaryRows));
    app.get('/api/rows/usage_summary', (_req, res) => res.json(usageSummaryRows));
    app.get('/api/rows/usage_heatmap', (_req, res) => res.json(usageHeatmapRows));
    app.get('/api/rows/usage_active_users_trend', (_req, res) => res.json(usageActiveUsersTrendRows));
    app.get('/api/rows/reliability_summary', (_req, res) => res.json(reliabilitySummaryRows));
    app.get('/api/rows/genie_readiness', (_req, res) => res.json(genieReadinessRows));
    app.get('/api/rows/genie_readiness_pillars', (_req, res) => res.json(genieReadinessPillarsRows));
    app.get('/api/rows/genie_cost_summary', (_req, res) => res.json(genieCostSummaryRows));
    app.get('/api/rows/genie_cost_by_user', (_req, res) => res.json(genieCostByUserRows));
  });
}
