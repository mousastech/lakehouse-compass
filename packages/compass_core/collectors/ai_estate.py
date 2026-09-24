"""AI Estate collector (spec §6.C).

Inventories model serving endpoints for the workspace from system.serving.
served_entities and emits the checks that are detectable from system tables:
  - AIG-014: endpoints owned by individuals (created_by is a user email),
  - AIG-001: external-model endpoints present (verify Gateway fronting).
Per-endpoint AI Gateway config (guardrails, spend caps, payload logging) is not
exposed in system tables, so AIG-003/004 are evaluated for Compass's own
endpoint in Self-check; here the affected capability is surfaced as DEGRADED.
"""

from __future__ import annotations

import json
from typing import Callable, Optional

from ..models.capability import Availability
from ..models.finding import Finding, Severity
from .base import CollectorResult, SparkLike, cap, rows_as_dicts


class AiEstateCollector:
    domain = "ai_estate"

    def __init__(self, workspace_id: str, scan_id: str = "live", workspace_name: str = "",
                 rest: Optional[Callable[..., dict]] = None):
        self.workspace_id = workspace_id
        self.workspace_name = workspace_name
        self.scan_id = scan_id
        # REST callable (local workspace only) to read per-endpoint ai_gateway
        # config, which system tables do not expose.
        self.rest = rest

    def collect(self, spark: SparkLike) -> CollectorResult:
        res = CollectorResult()
        try:
            rows = rows_as_dicts(
                spark,
                f"""
                SELECT endpoint_name, entity_type, created_by, entity_name, change_time
                FROM system.serving.served_entities
                WHERE workspace_id = '{self.workspace_id}' AND endpoint_delete_time IS NULL
                """,
            )
            res.capabilities.append(cap("serving", "system.serving.served_entities", Availability.AVAILABLE))
        except Exception as e:  # pragma: no cover
            res.capabilities.append(cap("serving", "system.serving.served_entities", Availability.NOT_AVAILABLE, str(e)[:200]))
            return res

        # de-duplicate to one row per endpoint
        seen: dict[str, dict] = {}
        for r in rows:
            ep = r.get("endpoint_name") or ""
            if ep and ep not in seen:
                seen[ep] = r
        inv = []
        for ep, r in seen.items():
            inv.append({
                "scan_id": self.scan_id,
                "workspace_id": self.workspace_id,
                "workspace_name": self.workspace_name,
                "endpoint_name": ep,
                "entity_type": r.get("entity_type") or "",
                "owner": r.get("created_by") or "",
                "entity_name": r.get("entity_name") or "",
            })
        res.inventory["ai_estate_inventory"] = inv

        individual_owned = [e for e in inv if "@" in (e["owner"] or "")]
        if individual_owned:
            res.findings.append(Finding(
                id=f"{self.scan_id}-AIG-014",
                rule_id="AIG-014",
                domain="ai_estate",
                title="Serving endpoints owned by individuals",
                severity=Severity.LOW,
                resource=f"{len(individual_owned)} endpoint(s) in workspace {self.workspace_id}",
                evidence={"count": len(individual_owned), "endpoints": [e["endpoint_name"] for e in individual_owned][:20]},
                remediation="Transfer endpoint ownership to a service principal or team group.",
                framework_controls=["DBX-SBP:IAM-3"],
                scan_id=self.scan_id,
                workspace_id=self.workspace_id,
                workspace_name=self.workspace_name,
            ))

        external = [e for e in inv if e["entity_type"] == "EXTERNAL_MODEL"]
        if external:
            res.findings.append(Finding(
                id=f"{self.scan_id}-AIG-001",
                rule_id="AIG-001",
                domain="ai_estate",
                title="External-model endpoints present — verify Unity AI Gateway fronting",
                severity=Severity.MEDIUM,
                resource=f"{len(external)} external-model endpoint(s)",
                evidence={"endpoints": [e["endpoint_name"] for e in external][:20]},
                remediation="Front external-model endpoints with Unity AI Gateway (usage tracking, payload logging, guardrails).",
                framework_controls=["DBX-SBP:MON-2"],
                scan_id=self.scan_id,
                workspace_id=self.workspace_id,
                workspace_name=self.workspace_name,
            ))

        # ---- Per-endpoint AI Gateway governance (REST; local workspace only) ----
        # system tables don't expose ai_gateway config, so we read it per endpoint.
        if self.rest is not None:
            gw_rows = []
            for ep in seen:
                try:
                    d = self.rest("GET", f"/api/2.0/serving-endpoints/{ep}") or {}
                    ag = d.get("ai_gateway") or {}
                    usage_tracking = bool((ag.get("usage_tracking_config") or {}).get("enabled"))
                    payload_logging = bool((ag.get("inference_table_config") or {}).get("enabled"))
                    rate_limits = bool(ag.get("rate_limits"))
                    guardrails = bool(ag.get("guardrails"))
                except Exception:
                    usage_tracking = payload_logging = rate_limits = guardrails = False
                gw_rows.append({
                    "scan_id": self.scan_id, "workspace_id": self.workspace_id,
                    "workspace_name": self.workspace_name, "endpoint_name": ep,
                    "usage_tracking": usage_tracking, "payload_logging": payload_logging,
                    "rate_limits": rate_limits, "guardrails": guardrails,
                    "governed": bool(usage_tracking and payload_logging and guardrails),
                })
            res.inventory["ai_gateway_config"] = gw_rows

        # ---- Usage / where-used from system.serving.endpoint_usage (spark) ----
        se_cte = (
            "WITH se AS (SELECT DISTINCT served_entity_id, endpoint_name FROM system.serving.served_entities "
            f"WHERE workspace_id = '{self.workspace_id}' AND endpoint_delete_time IS NULL)"
        )
        usage_where = (
            f"u.workspace_id = '{self.workspace_id}' "
            "AND u.request_time >= DATEADD(DAY, -30, CURRENT_DATE())"
        )
        try:
            usage = rows_as_dicts(
                spark,
                f"""
                {se_cte}
                SELECT COALESCE(se.endpoint_name, u.served_entity_id) AS endpoint_name,
                       COUNT(*) AS requests_30d,
                       COUNT(DISTINCT u.requester) AS requesters,
                       ROUND(SUM(COALESCE(u.input_token_count, 0)), 0) AS in_tokens,
                       ROUND(SUM(COALESCE(u.output_token_count, 0)), 0) AS out_tokens,
                       ROUND(100.0 * SUM(CASE WHEN u.status_code >= 400 THEN 1 ELSE 0 END) / COUNT(*), 1) AS error_rate,
                       CAST(MAX(u.request_time) AS STRING) AS last_request
                FROM system.serving.endpoint_usage u
                LEFT JOIN se ON u.served_entity_id = se.served_entity_id
                WHERE {usage_where}
                GROUP BY 1 ORDER BY requests_30d DESC
                """,
            )
            top = rows_as_dicts(
                spark,
                f"""
                {se_cte}
                SELECT COALESCE(se.endpoint_name, u.served_entity_id) AS endpoint_name,
                       u.requester AS requester, COUNT(*) AS requests
                FROM system.serving.endpoint_usage u
                LEFT JOIN se ON u.served_entity_id = se.served_entity_id
                WHERE {usage_where} AND u.requester IS NOT NULL
                GROUP BY 1, 2 ORDER BY requests DESC
                """,
            )
            by_ep: dict[str, list] = {}
            for r in top:
                ep = r.get("endpoint_name") or ""
                if len(by_ep.setdefault(ep, [])) < 8:
                    by_ep[ep].append({"requester": r.get("requester"), "requests": int(r.get("requests") or 0)})
            usage_rows = []
            for r in usage:
                ep = r.get("endpoint_name") or ""
                usage_rows.append({
                    "scan_id": self.scan_id, "workspace_id": self.workspace_id,
                    "workspace_name": self.workspace_name, "endpoint_name": ep,
                    "requests_30d": int(r.get("requests_30d") or 0),
                    "requesters": int(r.get("requesters") or 0),
                    "in_tokens": float(r.get("in_tokens") or 0.0),
                    "out_tokens": float(r.get("out_tokens") or 0.0),
                    "error_rate": float(r.get("error_rate") or 0.0),
                    "last_request": r.get("last_request") or "",
                    "top_requesters_json": json.dumps(by_ep.get(ep, []), default=str),
                })
            res.inventory["endpoint_usage_summary"] = usage_rows
        except Exception as e:  # pragma: no cover - depends on live grants
            print(f"[compass] endpoint_usage unavailable: {str(e)[:200]}")

        return res
