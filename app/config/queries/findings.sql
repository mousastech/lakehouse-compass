WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.findings GROUP BY workspace_id)
SELECT t.finding_id, t.rule_id, t.domain, t.title, t.severity, t.resource, t.status,
       t.framework_controls, t.evidence_json, t.remediation, t.self_check, t.workspace_id, t.workspace_name
FROM moi_ai_catalog.lakehouse_compass.findings t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
ORDER BY CASE t.severity WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END DESC, t.rule_id
