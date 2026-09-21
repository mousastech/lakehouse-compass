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

from ..models.capability import Availability
from ..models.finding import Finding, Severity
from .base import CollectorResult, SparkLike, cap, rows_as_dicts


class AiEstateCollector:
    domain = "ai_estate"

    def __init__(self, workspace_id: str, scan_id: str = "live", workspace_name: str = ""):
        self.workspace_id = workspace_id
        self.workspace_name = workspace_name
        self.scan_id = scan_id

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

        return res
