WITH latest AS (SELECT workspace_id, MAX(generated_at) AS generated_at FROM moi_ai_catalog.lakehouse_compass.digests GROUP BY workspace_id)
SELECT t.workspace_id, t.workspace_name, t.generated_at, t.score, t.score_delta, t.coverage_pct,
       t.crit, t.high, t.med, t.low, t.weakest_pillars_json, t.limited_pillars_json,
       t.new_json, t.resolved_json, t.still_open_json, t.criticals_json, t.narrative
FROM moi_ai_catalog.lakehouse_compass.digests t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.generated_at = l.generated_at
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
