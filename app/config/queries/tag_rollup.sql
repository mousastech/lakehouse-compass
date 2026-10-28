WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.tag_rollup GROUP BY workspace_id)
SELECT t.workspace_id, t.role, t.value, t.tables, t.tables_useful, t.columns, t.columns_useful,
       t.certified, t.deprecated, t.with_owner, t.gold, t.sensitive
FROM moi_ai_catalog.lakehouse_compass.tag_rollup t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
ORDER BY t.role, t.tables DESC
