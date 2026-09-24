WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.ai_gateway_config GROUP BY workspace_id)
SELECT t.workspace_id, t.workspace_name, t.endpoint_name,
       t.usage_tracking, t.payload_logging, t.rate_limits, t.guardrails, t.governed
FROM moi_ai_catalog.lakehouse_compass.ai_gateway_config t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
