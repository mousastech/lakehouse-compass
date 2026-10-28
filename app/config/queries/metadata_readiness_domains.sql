WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.metadata_readiness_domains GROUP BY workspace_id)
SELECT t.workspace_id, t.domain, t.tables, t.`index`, t.unweighted, t.documentation, t.sensitivity, t.ownership, t.curation
FROM moi_ai_catalog.lakehouse_compass.metadata_readiness_domains t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
ORDER BY CASE WHEN t.domain = '' THEN 1 ELSE 0 END, t.tables DESC
