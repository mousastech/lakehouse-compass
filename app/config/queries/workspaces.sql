SELECT DISTINCT s.workspace_id, COALESCE(w.workspace_name, s.workspace_name) AS workspace_name, w.env_label
FROM moi_ai_catalog.lakehouse_compass.scan_runs s
LEFT JOIN moi_ai_catalog.lakehouse_compass.workspaces w ON s.workspace_id = w.workspace_id
ORDER BY workspace_name
