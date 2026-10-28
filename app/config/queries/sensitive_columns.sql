WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.sensitive_columns GROUP BY workspace_id)
SELECT t.workspace_id, t.catalog, t.`schema`, t.`table`, t.`column`, t.source, t.tag_key, t.tag_value,
       t.tagged, t.protection, t.protected_by
FROM moi_ai_catalog.lakehouse_compass.sensitive_columns t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
ORDER BY CASE t.source WHEN 'tag' THEN 0 WHEN 'classification' THEN 1 ELSE 2 END,
         CASE WHEN t.protection = 'none' THEN 0 ELSE 1 END, t.catalog, t.`table`, t.`column`
LIMIT 500
