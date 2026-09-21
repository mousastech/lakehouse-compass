WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.cost_summary GROUP BY workspace_id)
SELECT t.workspace_id, t.product, t.sku, t.identity, t.cost_usd, t.dbus, t.is_ai
FROM moi_ai_catalog.lakehouse_compass.cost_summary t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
ORDER BY t.cost_usd DESC
