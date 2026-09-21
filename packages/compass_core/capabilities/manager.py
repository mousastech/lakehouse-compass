"""Capability manager (spec §4).

Probes test whether a data source / feature is reachable with the granted
permissions. Phase 0 ships probe *stubs* that resolve deterministically:
- in demo mode, a curated set resolves AVAILABLE / DEGRADED / NOT_AVAILABLE so
  the UI can render coverage and NOT_AVAILABLE states.
- with a live SparkSession/WorkspaceClient (later phases) each probe runs a
  cheap read and records availability, last_tested, error and freshness.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable

from ..models.capability import Availability, Capability

# Registry of the capabilities Compass probes. (subset for Phase 0; the full
# list from spec §4 is added as collectors land.)
PROBES: dict[str, dict[str, str]] = {
    "billing": {"kind": "system_table", "source": "system.billing.usage", "scope": "account"},
    "access": {"kind": "system_table", "source": "system.access.audit", "scope": "account"},
    "compute": {"kind": "api", "source": "clusters_api", "scope": "workspace"},
    "query": {"kind": "system_table", "source": "system.query.history", "scope": "workspace"},
    "lakeflow": {"kind": "system_table", "source": "system.lakeflow.jobs", "scope": "workspace"},
    "tags": {"kind": "information_schema", "source": "system.information_schema", "scope": "catalog"},
    "ai_gateway": {"kind": "system_table", "source": "system.serving.endpoints", "scope": "account"},
    "serving": {"kind": "api", "source": "serving_endpoints_api", "scope": "workspace"},
    "apps": {"kind": "api", "source": "apps_api", "scope": "workspace"},
    "genie": {"kind": "api", "source": "genie_api", "scope": "workspace"},
    "lakebase": {"kind": "pg_introspection", "source": "pg_roles/pg_stat", "scope": "project"},
    "mcp_catalog": {"kind": "api", "source": "mcp_catalog", "scope": "account"},
    "data_classification": {"kind": "system_table", "source": "system.information_schema", "scope": "catalog"},
    "sat": {"kind": "delta", "source": "security_analysis.results", "scope": "account"},
}

# Demo-mode resolutions (spec §15 fixtures). Anything not listed -> NOT_AVAILABLE.
_DEMO_AVAILABILITY: dict[str, Availability] = {
    "billing": Availability.AVAILABLE,
    "access": Availability.AVAILABLE,
    "compute": Availability.AVAILABLE,
    "query": Availability.AVAILABLE,
    "lakeflow": Availability.AVAILABLE,
    "tags": Availability.AVAILABLE,
    "ai_gateway": Availability.DEGRADED,  # preview controls partial
    "serving": Availability.AVAILABLE,
    "apps": Availability.AVAILABLE,
    "genie": Availability.AVAILABLE,
    "lakebase": Availability.DEGRADED,  # needs read-only role granted
    "mcp_catalog": Availability.NOT_AVAILABLE,  # preview / not enabled
    "data_classification": Availability.AVAILABLE,
    "sat": Availability.NOT_AVAILABLE,  # customer must run SAT
}


class CapabilityManager:
    def __init__(self, demo_mode: bool = True):
        self.demo_mode = demo_mode
        self._probers: dict[str, Callable[[], Capability]] = {}

    def register(self, cap_id: str, prober: Callable[[], Capability]) -> None:
        self._probers[cap_id] = prober

    def probe(self, cap_id: str) -> Capability:
        meta = PROBES[cap_id]
        now = datetime.now(timezone.utc).isoformat()
        if self.demo_mode or cap_id not in self._probers:
            availability = (
                _DEMO_AVAILABILITY.get(cap_id, Availability.NOT_AVAILABLE)
                if self.demo_mode
                else Availability.NOT_AVAILABLE
            )
            freshness = "hours" if meta["kind"] == "system_table" else "realtime"
            return Capability(
                id=cap_id,
                kind=meta["kind"],
                source=meta["source"],
                required_permission="SELECT" if meta["kind"] == "system_table" else "USE",
                scope=meta["scope"],
                availability=availability,
                last_tested=now,
                freshness=freshness,
            )
        return self._probers[cap_id]()

    def probe_all(self) -> list[Capability]:
        return [self.probe(cap_id) for cap_id in PROBES]

    def coverage_pct(self) -> float:
        caps = self.probe_all()
        usable = sum(1 for c in caps if c.is_usable)
        return round(100.0 * usable / len(caps), 1) if caps else 0.0
