import { createApp, server, analytics } from '@databricks/appkit';
import { setupApiRoutes } from './routes/api-routes';
import { setupReportRoutes } from './routes/reports-routes';
import { setupAgentRoutes } from './agent/agent-routes';
import { setupSelfCheckRoutes } from './routes/selfcheck-routes';
import { setupDiscoveryRoutes } from './routes/discovery-routes';
import { setupHistoryRoutes } from './routes/history-routes';
import { setupScanRoutes } from './routes/scan-routes';

// Phase 0: server plugin only. It binds 0.0.0.0 on DATABRICKS_APP_PORT, serves
// the built client from client/dist with SPA fallback, and handles graceful
// SIGTERM shutdown. No SQL warehouse / Lakebase / serving resources are needed
// because the app runs in DEMO_MODE. Later phases add analytics()/lakebase()/
// serving() plugins here alongside their App resources.
createApp({
  // analytics(): typed SQL reads of moi_ai_catalog.lakehouse_compass.* via the
  // bound SQL warehouse. server(): binds 0.0.0.0:DATABRICKS_APP_PORT, serves the
  // client, SPA fallback, SIGTERM shutdown. The demo /api/* routes remain as an
  // automatic fixture fallback when a Delta table is empty/absent.
  plugins: [server({ autoStart: false }), analytics()],
})
  .then(async (appkit) => {
    setupApiRoutes(appkit);
    setupReportRoutes(appkit);
    setupAgentRoutes(appkit);
    setupSelfCheckRoutes(appkit);
    setupDiscoveryRoutes(appkit);
    setupHistoryRoutes(appkit);
    setupScanRoutes(appkit);
    await appkit.server.start();
  })
  .catch((err) => {
    // Never leak stack traces to clients; log to stderr for the platform.
    console.error('[compass] fatal startup error:', err);
    process.exit(1);
  });
