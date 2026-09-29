"""Per-space Genie inventory: join the space list to usage, cost and a score.

Pure functions over rows the scan collected this run, so the whole surface is
verifiable offline:

* ``space_rows`` — from ``genie_inventory`` (Genie API): space_id, title,
  has_description, tables, owner.
* ``usage_by_space`` — from ``system.query.history`` grouped by
  ``query_source.genie_space_id``: msgs_30d, users_30d, msgs_7d, msgs_prev_7d.
* ``cost_by_space`` — from Genie billing (``usage_metadata.genie.agent_id``);
  partial by design (only GENIE_AGENTS carry a space id), so a missing entry is $0.
"""

from __future__ import annotations

from typing import Any

# Usage-status thresholds (messages over the window). A space nobody queries is
# Unused; a lightly-used one is Low use; a genuinely-adopted one is Active.
_ACTIVE_MIN_MSGS = 50
_ACTIVE_MIN_USERS = 3


def setup_score(has_description: bool, tables: int) -> int:
    """A 0-100 readiness score for a single space from what the API exposes.

    A trustworthy space says what it is for (description) and is grounded in
    curated tables. These are the two signals the Genie API gives per space;
    deeper hygiene (instructions, certified sample questions) is a follow-up.
    """
    score = 0
    if has_description:
        score += 45
    if tables >= 1:
        score += 35
    if tables >= 3:
        score += 20
    return min(100, score)


def usage_status(msgs_30d: int, users_30d: int) -> str:
    if msgs_30d <= 0:
        return "Unused"
    if msgs_30d >= _ACTIVE_MIN_MSGS or users_30d >= _ACTIVE_MIN_USERS:
        return "Active"
    return "Low use"


def _trend_pct(msgs_7d: int, msgs_prev_7d: int) -> float:
    if msgs_prev_7d <= 0:
        return 100.0 if msgs_7d > 0 else 0.0
    return round(100.0 * (msgs_7d - msgs_prev_7d) / msgs_prev_7d, 1)


def build_space_inventory(
    *,
    scan_id: str,
    workspace_id: str,
    workspace_name: str,
    space_rows: list[dict[str, Any]] | None = None,
    usage_by_space: dict[str, dict[str, Any]] | None = None,
    cost_by_space: dict[str, float] | None = None,
) -> list[dict[str, Any]]:
    space_rows = space_rows or []
    usage_by_space = usage_by_space or {}
    cost_by_space = cost_by_space or {}

    out: list[dict[str, Any]] = []
    for s in space_rows:
        sid = str(s.get("space_id") or "")
        if not sid:
            continue
        has_desc = bool(s.get("has_description"))
        tables = int(s.get("tables") or 0)
        u = usage_by_space.get(sid, {})
        msgs = int(u.get("msgs_30d") or 0)
        users = int(u.get("users_30d") or 0)
        msgs_7d = int(u.get("msgs_7d") or 0)
        msgs_prev_7d = int(u.get("msgs_prev_7d") or 0)
        out.append({
            "scan_id": scan_id,
            "workspace_id": workspace_id,
            "workspace_name": workspace_name,
            "space_id": sid,
            "title": str(s.get("title") or sid),
            "owner": str(s.get("owner") or ""),
            "has_description": has_desc,
            "tables": tables,
            "msgs_30d": msgs,
            "users_30d": users,
            "trend_pct": _trend_pct(msgs_7d, msgs_prev_7d),
            "cost_usd_30d": round(float(cost_by_space.get(sid, 0.0)), 2),
            "setup_score": setup_score(has_desc, tables),
            "usage_status": usage_status(msgs, users),
        })
    # Sort by messages desc so the busy spaces lead; the app can re-sort.
    out.sort(key=lambda r: r["msgs_30d"], reverse=True)
    return out
