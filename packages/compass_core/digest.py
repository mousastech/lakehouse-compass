"""Proactive status digest (autonomous-cadence roadmap, DECISIONS D18).

Turns two consecutive scans into a plain-language status an admin can read
WITHOUT knowing the platform: overall score + trend, the weakest Well-Architected
pillars, what changed since last scan (new / resolved / still-open findings) and
the criticals to act on now.

Pure functions -> unit-testable offline. The digest job (jobs/digest/run_digest.py)
persists the result to Delta and optionally pushes it to a Slack webhook; it never
executes remediation (the agent proposes, humans dispose)."""

from __future__ import annotations

from .diff import diff_rule_sets

# Fewer mapped rules than this ⇒ a pillar's score reflects limited checking, not
# proven health. Kept in sync with the app's Well-Architected view.
LIMITED_COVERAGE = 3

# Short human labels for narrative text (the app UI localizes separately).
PILLAR_LABELS: dict[str, str] = {
    "operational_excellence": "Operational Excellence",
    "security": "Security, Privacy & Compliance",
    "reliability": "Reliability",
    "performance_efficiency": "Performance Efficiency",
    "cost_optimization": "Cost Optimization",
    "data_ai_governance": "Data & AI Governance",
    "interoperability_usability": "Interoperability & Usability",
}


def build_digest(
    *,
    workspace_name: str,
    current: dict,
    previous: dict | None,
    waf_pillars: list[dict],
    current_rule_ids: set[str],
    previous_rule_ids: set[str],
    criticals: list[dict],
) -> dict:
    """Assemble a structured digest from scan facts.

    `current`/`previous` are scan_runs-shaped dicts (overall_score, coverage_pct,
    crit/high/med/low, generated_at). `waf_pillars` is the current scan's
    per-pillar rows. `criticals` is the current open critical findings
    (rule_id/title/resource). `previous` may be None for a first scan.
    """
    score = round(float(current.get("overall_score") or 0.0), 1)
    prev_score = None if previous is None else round(float(previous.get("overall_score") or 0.0), 1)
    score_delta = None if prev_score is None else round(score - prev_score, 1)

    rule_diff = diff_rule_sets(current_rule_ids, previous_rule_ids if previous else set())

    # Weakest pillars: lowest score first, but only among pillars that are actually
    # being checked (>= LIMITED_COVERAGE rules) so we don't headline an unmeasured 100.
    measured = [p for p in waf_pillars if int(p.get("rules") or 0) >= LIMITED_COVERAGE]
    weakest = sorted(measured, key=lambda p: float(p.get("score") or 0.0))[:3]
    limited = sorted(
        [p for p in waf_pillars if int(p.get("rules") or 0) < LIMITED_COVERAGE],
        key=lambda p: int(p.get("rules") or 0),
    )

    return {
        "workspace_name": workspace_name,
        "generated_at": current.get("generated_at"),
        "score": score,
        "score_delta": score_delta,
        "coverage_pct": round(float(current.get("coverage_pct") or 0.0), 1),
        "severity_counts": {
            "critical": int(current.get("crit") or 0),
            "high": int(current.get("high") or 0),
            "medium": int(current.get("med") or 0),
            "low": int(current.get("low") or 0),
        },
        "weakest_pillars": [
            {"pillar": p["pillar"], "score": round(float(p.get("score") or 0.0), 1),
             "findings": int(p.get("findings") or 0)}
            for p in weakest
        ],
        "limited_coverage_pillars": [p["pillar"] for p in limited],
        "changes": {
            "new": rule_diff["new"],
            "resolved": rule_diff["resolved"],
            "still_open": rule_diff["regressed"],
        },
        "criticals": [
            {"rule_id": c.get("rule_id"), "title": c.get("title"), "resource": c.get("resource")}
            for c in criticals
        ],
    }


def _trend_phrase(delta: float | None) -> str:
    if delta is None:
        return "first scan — no trend yet"
    if delta > 0:
        return f"up {delta:+.1f} since the last scan"
    if delta < 0:
        return f"down {delta:.1f} since the last scan"
    return "unchanged since the last scan"


def narrative(digest: dict) -> str:
    """Render the digest as a short plain-language status message."""
    lines: list[str] = []
    ws = digest.get("workspace_name") or "this workspace"
    lines.append(f"Lakehouse Compass status for {ws}")
    lines.append(
        f"Health score {digest['score']}/100 ({_trend_phrase(digest.get('score_delta'))}); "
        f"rule coverage {digest['coverage_pct']}%."
    )

    sc = digest["severity_counts"]
    if sc["critical"] or sc["high"]:
        lines.append(f"Open now: {sc['critical']} critical, {sc['high']} high, {sc['medium']} medium.")
    else:
        lines.append("No critical or high findings open — nice.")

    weak = digest.get("weakest_pillars") or []
    if weak:
        parts = [f"{PILLAR_LABELS.get(p['pillar'], p['pillar'])} ({p['score']})" for p in weak]
        lines.append("Weakest Well-Architected pillars: " + ", ".join(parts) + ".")

    limited = digest.get("limited_coverage_pillars") or []
    if limited:
        labels = ", ".join(PILLAR_LABELS.get(p, p) for p in limited)
        lines.append(f"Barely checked yet (add rules to trust the score): {labels}.")

    ch = digest["changes"]
    lines.append(
        f"Since last scan: {len(ch['new'])} new, {len(ch['resolved'])} resolved, "
        f"{len(ch['still_open'])} still open."
    )
    if ch["new"]:
        lines.append("New: " + ", ".join(ch["new"][:8]) + ("…" if len(ch["new"]) > 8 else "") + ".")

    crits = digest.get("criticals") or []
    if crits:
        lines.append("Act first:")
        for c in crits[:5]:
            lines.append(f"  • [{c['rule_id']}] {c['title']} — {c['resource']}")

    return "\n".join(lines)
