WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.waf_controls GROUP BY workspace_id)
SELECT t.workspace_id, t.pillar, t.control_id, t.principle, t.title, t.provenance, t.measurability,
       t.severity, t.status, t.measured, t.rule_id, t.remediation, t.doc_url
FROM moi_ai_catalog.lakehouse_compass.waf_controls t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
