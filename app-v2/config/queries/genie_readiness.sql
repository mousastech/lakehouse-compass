WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.genie_readiness GROUP BY workspace_id)
SELECT t.workspace_id, t.workspace_name, t.overall_score, t.level, t.level_label,
       t.readiness_stage, t.guidance, t.top_gaps_json, t.pillars_available, t.assessed_at
FROM moi_ai_catalog.lakehouse_compass.genie_readiness t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
