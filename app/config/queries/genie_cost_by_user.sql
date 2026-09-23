WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.genie_cost_by_user GROUP BY workspace_id)
SELECT t.workspace_id, t.workspace_name, t.run_as_user, t.genie_surface,
       t.free_dbus, t.paid_dbus, t.billed_cost_usd, t.free_allowance_limit, t.over_allowance
FROM moi_ai_catalog.lakehouse_compass.genie_cost_by_user t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
ORDER BY t.billed_cost_usd DESC, t.paid_dbus DESC
