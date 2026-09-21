WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.genie_readiness_pillars GROUP BY workspace_id)
SELECT t.workspace_id, t.workspace_name, t.pillar_key, t.name, t.weight, t.score, t.technical_score,
       t.level, t.level_label, t.available, t.unavailable_reason, t.signals_json, t.gaps_json, t.metrics_json
FROM moi_ai_catalog.lakehouse_compass.genie_readiness_pillars t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
