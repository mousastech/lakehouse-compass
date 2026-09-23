WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.compute_inventory GROUP BY workspace_id)
SELECT t.workspace_id, t.workspace_name, t.kind, t.compute_id, t.name, t.size, t.serverless,
       t.auto_stop_min, t.min_clusters, t.max_clusters, t.dbr_version, t.state, t.owner,
       t.queries_30d, t.avg_ms, t.p90_ms, t.dbus_30d, t.cost_usd_30d
FROM moi_ai_catalog.lakehouse_compass.compute_inventory t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
ORDER BY t.cost_usd_30d DESC, t.queries_30d DESC
