"""Finding model (spec §5). A Finding is one evaluated rule against one
resource, with evidence and remediation. v3 adds framework_controls,
maintenance_task_id and self_check."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"

    @property
    def rank(self) -> int:
        return {"critical": 5, "high": 4, "medium": 3, "low": 2, "info": 1}[self.value]


class Status(str, Enum):
    OPEN = "open"
    ACCEPTED_RISK = "accepted_risk"
    RESOLVED = "resolved"
    NOT_MEASURABLE = "not_measurable"


@dataclass
class Finding:
    id: str
    rule_id: str
    domain: str
    title: str
    severity: Severity
    resource: str
    status: Status = Status.OPEN
    evidence: dict[str, Any] = field(default_factory=dict)
    remediation: str = ""
    # v3 fields
    framework_controls: list[str] = field(default_factory=list)
    # WAF pillar slugs this finding contributes to (derived from its rule).
    waf_pillars: list[str] = field(default_factory=list)
    maintenance_task_id: str | None = None
    self_check: bool = False
    scan_id: str | None = None
    workspace_id: str = ""
    workspace_name: str = ""
    detected_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_row(self) -> dict[str, Any]:
        """Flatten to a Delta-friendly row (matches sql/ddl/schema.sql).
        Evidence is JSON-encoded so the Findings drawer can render it without a
        nested Delta schema."""
        import json

        return {
            "finding_id": self.id,
            "rule_id": self.rule_id,
            "domain": self.domain,
            "title": self.title,
            "severity": self.severity.value,
            "resource": self.resource,
            "status": self.status.value,
            "framework_controls": self.framework_controls,
            "waf_pillars": self.waf_pillars,
            "evidence_json": json.dumps(self.evidence, default=str),
            "remediation": self.remediation,
            "maintenance_task_id": self.maintenance_task_id,
            "self_check": self.self_check,
            "scan_id": self.scan_id,
            "workspace_id": self.workspace_id,
            "workspace_name": self.workspace_name,
            "detected_at": self.detected_at,
        }
