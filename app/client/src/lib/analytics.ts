import { useEffect, useState } from 'react';
import { useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { asRows } from './rows';

// AppKit 0.24 generates a per-query union for useAnalyticsQuery's name+params,
// which a generic helper can't satisfy. Re-type it to a permissive signature and
// route every field through asRows()/Number() as the deploy-env guidance says.
const useQuery = useAnalyticsQuery as unknown as (
  name: string,
  params?: Record<string, unknown>
) => { data: unknown; loading: boolean; error: unknown };

/**
 * Live Delta read with an automatic fixture fallback (spec §20.4).
 *
 * Tries the named analytics query (config/queries/<name>.sql). If it errors or
 * returns zero rows, falls back to a bundled fixture endpoint (/api/rows/*).
 * When `ws` is provided (possibly '' for Account mode), it is bound as the
 * :p_ws query parameter to filter by workspace; omit `ws` for queries that take
 * no parameter (e.g. workspaces). Never passes an explicit generic to
 * useAnalyticsQuery (AppKit 0.24); dynamic name cast to its parameter type.
 */
export function useLiveRows(
  queryName: string,
  fixturePath: string,
  ws?: string
): { rows: Record<string, unknown>[]; loading: boolean; source: 'live' | 'demo' | 'loading' } {
  const params = ws === undefined ? {} : { p_ws: sql.string(ws) };
  const { data, loading, error } = useQuery(queryName, params);

  const [fixture, setFixture] = useState<Record<string, unknown>[] | null>(null);
  const [fixtureLoading, setFixtureLoading] = useState(false);

  const liveRows = asRows(data);
  const liveEmptyOrError = !loading && (error != null || liveRows.length === 0);

  useEffect(() => {
    if (!liveEmptyOrError || fixture !== null || fixtureLoading) return;
    setFixtureLoading(true);
    fetch(fixturePath)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => setFixture(asRows(json)))
      .catch(() => setFixture([]))
      .finally(() => setFixtureLoading(false));
  }, [liveEmptyOrError, fixture, fixtureLoading, fixturePath]);

  if (loading) return { rows: [], loading: true, source: 'loading' };
  if (liveRows.length > 0) return { rows: liveRows, loading: false, source: 'live' };
  if (fixture !== null) return { rows: fixture, loading: false, source: 'demo' };
  return { rows: [], loading: fixtureLoading, source: 'loading' };
}
