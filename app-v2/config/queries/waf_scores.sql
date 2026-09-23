WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.waf_scores GROUP BY workspace_id)
SELECT t.workspace_id, t.workspace_name, t.pillar, t.score, t.findings, t.critical_findings, t.rules,
       t.controls_total, t.controls_measured, t.controls_passed, t.low, t.high
FROM moi_ai_catalog.lakehouse_compass.waf_scores t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
