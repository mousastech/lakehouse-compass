WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.genie_space_inventory GROUP BY workspace_id)
SELECT t.workspace_id, t.workspace_name, t.space_id, t.title, t.owner, t.has_description, t.tables,
       t.msgs_30d, t.users_30d, t.trend_pct, t.cost_usd_30d, t.setup_score, t.usage_status
FROM moi_ai_catalog.lakehouse_compass.genie_space_inventory t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
ORDER BY t.msgs_30d DESC
