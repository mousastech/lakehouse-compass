WITH latest AS (SELECT workspace_id, MAX(scan_id) AS scan_id FROM moi_ai_catalog.lakehouse_compass.finops_recommendations GROUP BY workspace_id)
SELECT t.workspace_id, t.workspace_name, t.recommendation_id, t.rule_id, t.rule_title, t.category,
       t.resource_type, t.resource_id, t.resource_name, t.resource_owner, t.why, t.how,
       t.monthly_spend_usd, t.savings_point_usd, t.savings_low_usd, t.savings_high_usd,
       t.savings_status, t.confidence, t.effort_band, t.effort_score, t.priority, t.nba_score,
       t.observed_days, t.evidence_json
FROM moi_ai_catalog.lakehouse_compass.finops_recommendations t
JOIN latest l ON t.workspace_id = l.workspace_id AND t.scan_id = l.scan_id
WHERE (:p_ws = '' OR t.workspace_id = :p_ws)
ORDER BY t.nba_score DESC
