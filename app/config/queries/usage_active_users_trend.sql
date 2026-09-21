WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.usage_active_users_trend GROUP BY workspace_id)
SELECT t.period_start, t.active_users, t.genie_users, t.workspace_id
FROM moi_ai_catalog.lakehouse_compass.usage_active_users_trend t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
ORDER BY t.period_start
