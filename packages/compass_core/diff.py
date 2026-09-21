"""Shared scan-diff logic (spec §20.3 Scan Diff Timeline).

Canonical semantics used by BOTH the report job (Python) and the app's History
view (mirrored in SQL config/queries/scan_diff.sql):
  - new       : rule fired in the current scan but not the previous
  - resolved  : rule fired in the previous scan but not the current
  - regressed : rule fired in both (still open / persisting)
"""

from __future__ import annotations


def diff_rule_sets(current: set[str], previous: set[str]) -> dict[str, list[str]]:
    return {
        "new": sorted(current - previous),
        "resolved": sorted(previous - current),
        "regressed": sorted(current & previous),
    }
