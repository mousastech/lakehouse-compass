WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.genie_cost_summary GROUP BY workspace_id)
SELECT t.workspace_id, t.workspace_name, t.window_days,
       t.billed_cost_usd, t.billed_dbus, t.free_dbus, t.active_users,
       t.by_surface_json, t.by_channel_json, t.by_sku_json, t.trend_json
FROM moi_ai_catalog.lakehouse_compass.genie_cost_summary t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
