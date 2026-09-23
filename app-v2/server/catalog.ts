// Single source of truth for the catalog/schema the app reads. Parameterized so
// Compass can run in any workspace (see DECISIONS D22). Resolution order:
//   1. COMPASS_CATALOG env (explicit override), else
//   2. a per-workspace mapping keyed on DATABRICKS_HOST (Databricks Apps inject it),
//   3. the moi_ai_catalog default.
// Databricks Apps env comes only from app.yaml (static/shared), so the host map is
// how the catalog varies per deployment without editing app.yaml. Add a workspace
// by adding one entry here (or set COMPASS_CATALOG).
const HOST_CATALOG: Record<string, string> = {
  'fevm-moi-ai': 'moi_ai_catalog',
  'engie-noprod': 'noprod_eep_electricity_utilities_storage',
};

function resolveCatalog(): string {
  if (process.env.COMPASS_CATALOG) return process.env.COMPASS_CATALOG;
  const host = process.env.DATABRICKS_HOST || '';
  for (const [needle, cat] of Object.entries(HOST_CATALOG)) {
    if (host.includes(needle)) return cat;
  }
  return 'moi_ai_catalog';
}

const CATALOG = resolveCatalog();
const SCHEMA = 'lakehouse_compass';

export const CAT = `${CATALOG}.${SCHEMA}`;
export const REPORTS_PREFIX = `/Volumes/${CATALOG}/${SCHEMA}/reports/`;
