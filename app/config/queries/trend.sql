SELECT scan_id, workspace_id, workspace_name, generated_at, overall_score, coverage_pct, crit, high, med, low, total_findings
FROM moi_ai_catalog.lakehouse_compass.scan_runs
WHERE (:p_ws = '' OR workspace_id = :p_ws)
ORDER BY generated_at DESC
LIMIT 12
