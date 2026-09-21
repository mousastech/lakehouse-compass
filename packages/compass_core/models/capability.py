"""Capability model (spec §4). Every check that depends on a data source or
feature goes through capability detection and may resolve to NOT_AVAILABLE."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Availability(str, Enum):
    AVAILABLE = "AVAILABLE"
    NOT_AVAILABLE = "NOT_AVAILABLE"
    DEGRADED = "DEGRADED"
    CONTEXT_DEPENDENT = "CONTEXT_DEPENDENT"


@dataclass
class Capability:
    id: str
    kind: str  # e.g. system_table, api, pg_introspection
    source: str  # e.g. system.billing.usage, apps_api
    required_permission: str
    scope: str  # account | workspace | catalog | project
    availability: Availability = Availability.NOT_AVAILABLE
    last_tested: str | None = None
    error: str | None = None
    freshness: str | None = None  # e.g. "hours" | "realtime"

    @property
    def is_usable(self) -> bool:
        return self.availability in (Availability.AVAILABLE, Availability.DEGRADED)
