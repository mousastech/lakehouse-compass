SELECT s.workspace_id, COALESCE(w.workspace_name, s.workspace_name) AS workspace_name, w.env_label
FROM (
  SELECT workspace_id, MAX(workspace_name) AS workspace_name, MAX(generated_at) AS last_scan
  FROM moi_ai_catalog.lakehouse_compass.scan_runs GROUP BY workspace_id
) s
LEFT JOIN moi_ai_catalog.lakehouse_compass.workspaces w ON s.workspace_id = w.workspace_id
ORDER BY s.last_scan DESC
