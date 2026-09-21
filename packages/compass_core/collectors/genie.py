"""Genie collector (spec §6.E) — runs in the scan job via a REST callable
(databricks-sdk WorkspaceClient.api_client.do). Lists Genie Agents + metadata
and emits GEN-001 for agents missing descriptions. Populates genie_inventory.

`rest` signature: rest(method: str, path: str) -> dict. If None or failing, the
capability resolves NOT_AVAILABLE (never fabricated)."""

from __future__ import annotations

from typing import Callable, Optional

from ..models.capability import Availability
from ..models.finding import Finding, Severity
from .base import CollectorResult, cap


class GenieCollector:
    domain = "genie"

    def __init__(self, rest: Optional[Callable[[str, str], dict]], workspace_id: str, scan_id: str = "live", workspace_name: str = ""):
        self.rest = rest
        self.workspace_id = workspace_id
        self.workspace_name = workspace_name
        self.scan_id = scan_id

    def collect(self, _spark=None) -> CollectorResult:
        res = CollectorResult()
        if self.rest is None:
            res.capabilities.append(cap("genie", "genie_api", Availability.NOT_AVAILABLE, "No API credentials available in the scan job."))
            return res
        try:
            listing = self.rest("GET", "/api/2.0/genie/spaces?page_size=100") or {}
            spaces = listing.get("spaces", []) or []
            res.capabilities.append(cap("genie", "genie_api", Availability.AVAILABLE))
        except Exception as e:  # pragma: no cover
            res.capabilities.append(cap("genie", "genie_api", Availability.NOT_AVAILABLE, str(e)[:200]))
            return res

        inv = []
        missing = []
        for s in spaces[:20]:
            sid = s.get("space_id")
            title = s.get("title") or sid
            desc = s.get("description") or ""
            tables = 0
            try:
                d = self.rest("GET", f"/api/2.0/genie/spaces/{sid}") or {}
                desc = d.get("description") or desc
                ti = d.get("table_identifiers")
                tables = len(ti) if isinstance(ti, list) else tables
            except Exception:
                pass
            has_desc = bool(str(desc).strip())
            inv.append({"scan_id": self.scan_id, "workspace_id": self.workspace_id, "workspace_name": self.workspace_name,
                        "space_id": str(sid), "title": str(title), "has_description": has_desc, "tables": int(tables or 0)})
            if not has_desc:
                missing.append(str(title))
        res.inventory["genie_inventory"] = inv

        if missing:
            res.findings.append(Finding(
                id=f"{self.scan_id}-GEN-001",
                rule_id="GEN-001",
                domain="genie",
                title="Genie Agents missing descriptions / instructions",
                severity=Severity.MEDIUM,
                resource=f"{len(missing)} of {len(inv)} agents",
                evidence={"agents_missing_description": missing[:15], "total_agents": len(inv)},
                remediation="Add descriptions, instructions and certified sample questions to each Genie Agent.",
                framework_controls=["DBX-SBP:GOV-2"],
                scan_id=self.scan_id,
                workspace_id=self.workspace_id,
                workspace_name=self.workspace_name,
            ))
        return res
