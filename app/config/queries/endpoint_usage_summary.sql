WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.endpoint_usage_summary GROUP BY workspace_id)
SELECT t.workspace_id, t.workspace_name, t.endpoint_name,
       t.requests_30d, t.requesters, t.in_tokens, t.out_tokens, t.error_rate, t.last_request, t.top_requesters_json
FROM moi_ai_catalog.lakehouse_compass.endpoint_usage_summary t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
ORDER BY t.requests_30d DESC
