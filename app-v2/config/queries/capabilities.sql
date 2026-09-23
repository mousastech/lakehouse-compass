WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.capabilities GROUP BY workspace_id)
SELECT t.workspace_id, t.capability_id, t.source, t.availability
FROM moi_ai_catalog.lakehouse_compass.capabilities t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
