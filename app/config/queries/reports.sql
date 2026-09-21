SELECT report_id, scan_id, workspace_id, workspace_name, generated_at, overall_score, coverage_pct, crit, high, med, low, framework, met, not_met, rendered, volume_path
FROM moi_ai_catalog.lakehouse_compass.checkup_reports
WHERE (:p_ws = '' OR workspace_id = :p_ws)
ORDER BY generated_at DESC
LIMIT 25
