WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.compliance_results GROUP BY workspace_id)
SELECT t.workspace_id, t.framework, t.control_id, t.title, t.category, t.status
FROM moi_ai_catalog.lakehouse_compass.compliance_results t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
