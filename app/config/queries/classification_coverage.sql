WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.classification_coverage GROUP BY workspace_id)
SELECT t.workspace_id, t.catalog, t.enabled, t.detail
FROM moi_ai_catalog.lakehouse_compass.classification_coverage t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
ORDER BY t.enabled, t.catalog
