"""Collector base (spec §3.1, §4).

A collector runs read-only queries against System Tables / APIs for one or more
domains and returns findings plus any inventory rows and the capabilities it
exercised. Collectors are defensive: a failed source resolves that capability to
NOT_AVAILABLE and yields no findings (never fabricated)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from ..models.capability import Availability, Capability
from ..models.finding import Finding


class SparkLike(Protocol):
    def sql(self, query: str) -> Any: ...


@dataclass
class CollectorResult:
    findings: list[Finding] = field(default_factory=list)
    capabilities: list[Capability] = field(default_factory=list)
    # extra inventory rows keyed by logical table name (e.g. "cost_summary")
    inventory: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    # optional sub-score contribution (e.g. Semantic Readiness from governance)
    semantic_readiness: float | None = None


def rows_as_dicts(spark: SparkLike, query: str) -> list[dict[str, Any]]:
    """Run a query and return plain dict rows (JSON-serializable)."""
    df = spark.sql(query)
    return [r.asDict(recursive=True) for r in df.collect()]


def cap(cap_id: str, source: str, availability: Availability, error: str | None = None) -> Capability:
    from datetime import datetime, timezone

    return Capability(
        id=cap_id,
        kind="system_table",
        source=source,
        required_permission="SELECT",
        scope="account",
        availability=availability,
        last_tested=datetime.now(timezone.utc).isoformat(),
        error=error,
        freshness="hours",
    )
