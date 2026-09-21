WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.ai_estate_inventory GROUP BY workspace_id)
SELECT t.endpoint_name, t.entity_type, t.owner, t.entity_name, t.workspace_id
FROM moi_ai_catalog.lakehouse_compass.ai_estate_inventory t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
ORDER BY t.entity_type, t.endpoint_name
