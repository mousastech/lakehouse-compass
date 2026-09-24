// Rewrites the catalog in config/queries/*.sql to match the deployment's catalog
// before the app builds, so the analytics plugin reads the right workspace's
// tables. Resolution mirrors app/server/catalog.ts: COMPASS_CATALOG env, else a
// per-workspace map keyed on DATABRICKS_HOST, else the moi_ai_catalog default
// (a no-op for the committed queries). Schema stays `lakehouse_compass`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HOST_CATALOG = {
  'fevm-moi-ai': 'moi_ai_catalog',
  'engie-noprod': 'noprod_eep_electricity_utilities_storage',
  'engie-bra-ebe': 'noprod_ebe_it',
};

function resolveCatalog() {
  if (process.env.COMPASS_CATALOG) return process.env.COMPASS_CATALOG;
  const host = process.env.DATABRICKS_HOST || '';
  for (const [needle, cat] of Object.entries(HOST_CATALOG)) {
    if (host.includes(needle)) return cat;
  }
  return 'moi_ai_catalog';
}

const cat = resolveCatalog();
if (cat === 'moi_ai_catalog') {
  console.log('[compass] catalog=moi_ai_catalog (default) — queries unchanged');
} else {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'queries');
  let n = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.sql')) continue;
    const p = join(dir, f);
    const src = readFileSync(p, 'utf8');
    const out = src.replaceAll('moi_ai_catalog.lakehouse_compass', `${cat}.lakehouse_compass`);
    if (out !== src) { writeFileSync(p, out); n++; }
  }
  console.log(`[compass] resolved ${n} query file(s) to catalog ${cat}`);
}
