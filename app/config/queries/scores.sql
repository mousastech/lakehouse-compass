WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.scores GROUP BY workspace_id)
SELECT t.workspace_id, t.workspace_name, t.domain, t.weight, t.score, t.findings, t.critical_findings, t.is_overall, t.coverage_pct
FROM moi_ai_catalog.lakehouse_compass.scores t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
