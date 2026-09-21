"""Synthetic demo findings (spec §15). These drive DEMO_MODE end-to-end: the
scan job writes them to Delta and the scoring/compliance layers consume them.
They intentionally align with the rules in rules/definitions/*.yaml so the
demo compliance wall lights up realistically."""

from __future__ import annotations

from ..capabilities import CapabilityManager
from ..compliance import ComplianceMapper, load_framework
from ..models.finding import Finding, Severity, Status
from ..models.rule import WafPillar
from ..rules import RuleRegistry
from ..scoring import attach_waf_pillars, overall_score

SCAN_ID = "demo-scan-0001"


def demo_findings() -> list[Finding]:
    return [
        Finding(
            id="F-1001",
            rule_id="SEC-027",
            domain="security",
            title="App service principal holds ALL PRIVILEGES on a catalog",
            severity=Severity.CRITICAL,
            resource="sp: compass-app / catalog: main",
            framework_controls=["DBX-SBP:IAM-3", "ISO27001:A.5.15", "SOC2:CC6.1"],
            self_check=True,
            scan_id=SCAN_ID,
        ),
        Finding(
            id="F-1004",
            rule_id="SEC-029",
            domain="security",
            title="Workspace still allows PATs where OAuth is feasible",
            severity=Severity.HIGH,
            resource="workspace: fevm-moi-ai",
            framework_controls=["DBX-SBP:IAM-5", "CIS:1.2"],
            scan_id=SCAN_ID,
        ),
        Finding(
            id="F-1002",
            rule_id="AIG-003",
            domain="ai_estate",
            title="Serving endpoint without spend cap; unattributed AI spend above threshold",
            severity=Severity.HIGH,
            resource="endpoint: prod-rag-router",
            framework_controls=["AIGOV:BUDGET-1", "DBX-SBP:MON-2"],
            scan_id=SCAN_ID,
        ),
        Finding(
            id="F-1003",
            rule_id="AIG-004",
            domain="ai_estate",
            title="User-facing endpoint without input/output guardrails",
            severity=Severity.HIGH,
            resource="endpoint: support-agent",
            framework_controls=["AIGOV:GUARD-1", "DBX-SBP:DATA-3"],
            scan_id=SCAN_ID,
        ),
        Finding(
            id="F-1005",
            rule_id="FIN-029",
            domain="finops",
            title="Lakebase project without scale-to-zero on non-production compute",
            severity=Severity.MEDIUM,
            resource="lakebase: analytics-dev",
            framework_controls=["DBX-SBP:MON-4"],
            scan_id=SCAN_ID,
        ),
        Finding(
            id="F-1006",
            rule_id="GEN-013",
            domain="genie",
            title="Genie Agent built on tables without certified metric views",
            severity=Severity.MEDIUM,
            resource="genie: revenue-explorer",
            framework_controls=["DBX-SBP:GOV-2"],
            scan_id=SCAN_ID,
        ),
        Finding(
            id="F-1008",
            rule_id="GEN-READY-METRICS",
            domain="genie_readiness",
            title="Genie readiness gap — Metrics (Absent, 0/100)",
            severity=Severity.MEDIUM,
            resource="pillar: Metrics · ws moi-ai",
            framework_controls=["DBX-SBP:GOV-2"],
            scan_id=SCAN_ID,
        ),
        Finding(
            id="F-1009",
            rule_id="GEN-READY-METADATA",
            domain="genie_readiness",
            title="Genie readiness gap — Metadata Richness (Developing, 44/100)",
            severity=Severity.LOW,
            resource="pillar: Metadata Richness · ws moi-ai",
            framework_controls=["DBX-SBP:GOV-2"],
            scan_id=SCAN_ID,
        ),
        Finding(
            id="F-1007",
            rule_id="LKB-001",
            domain="lakebase",
            title="Native password authentication enabled on Lakebase project",
            severity=Severity.HIGH,
            resource="lakebase: app-state",
            framework_controls=["DBX-SBP:IAM-7"],
            self_check=True,
            scan_id=SCAN_ID,
        ),
    ]


def demo_scan() -> dict:
    """Run the full demo pipeline: capabilities -> findings -> score ->
    compliance. Returns a plain dict ready to serialize to Delta / JSON."""
    caps = CapabilityManager(demo_mode=True)
    coverage = caps.coverage_pct()
    registry = RuleRegistry()
    findings = attach_waf_pillars(demo_findings(), registry)
    rule_counts = {p.value: len(registry.by_waf_pillar(p.value)) for p in WafPillar}
    score = overall_score(findings, coverage_pct=coverage, scan_id=SCAN_ID, rule_counts=rule_counts)

    framework = load_framework("dbx-security-best-practices")
    mapper = ComplianceMapper(framework)
    control_results = mapper.evaluate(findings)
    compliance = mapper.coverage_summary(control_results)

    return {
        "scan_id": SCAN_ID,
        "coverage_pct": coverage,
        "overall_score": score.overall,
        "domains": [
            {
                "domain": d.domain,
                "weight": d.weight,
                "score": d.score,
                "findings": d.findings,
                "critical_findings": d.critical_findings,
            }
            for d in score.domains
        ],
        "waf_pillars": [
            {
                "pillar": p.pillar,
                "score": p.score,
                "findings": p.findings,
                "critical_findings": p.critical_findings,
                "rules": p.rules,
            }
            for p in score.waf_pillars
        ],
        "findings": [f.to_row() for f in findings],
        "capabilities": [
            {"id": c.id, "availability": c.availability.value, "source": c.source}
            for c in caps.probe_all()
        ],
        "compliance": compliance,
        "compliance_controls": [
            {
                "control_id": r.control_id,
                "title": r.title,
                "category": r.category,
                "status": r.status.value,
                "linked_findings": r.linked_findings,
            }
            for r in control_results
        ],
    }
