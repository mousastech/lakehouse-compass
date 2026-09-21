WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.cost_detail GROUP BY workspace_id)
SELECT t.workspace_id, t.workspace_name, t.product, t.sku, t.identity, t.resource_type, t.resource_name, t.owner, t.tags_json, t.cost_usd, t.dbus, t.records
FROM moi_ai_catalog.lakehouse_compass.cost_detail t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
