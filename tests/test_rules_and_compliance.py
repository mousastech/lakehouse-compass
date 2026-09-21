"""Unit tests for the rule registry, capability manager and compliance mapper."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages"))

from compass_core.capabilities import CapabilityManager  # noqa: E402
from compass_core.compliance import ComplianceMapper, ControlStatus, load_framework  # noqa: E402
from compass_core.demo import demo_findings, demo_scan  # noqa: E402
from compass_core.rules import RuleRegistry  # noqa: E402


def test_registry_loads_rules():
    reg = RuleRegistry()
    assert len(reg) >= 8
    assert reg.get("SEC-027") is not None
    assert reg.get("LKB-001").domain == "lakebase"


def test_rules_span_multiple_domains():
    reg = RuleRegistry()
    domains = {r.domain for r in reg.all()}
    assert {"security", "finops", "ai_estate", "genie", "lakebase"}.issubset(domains)


def test_capability_manager_demo_coverage():
    caps = CapabilityManager(demo_mode=True)
    cov = caps.coverage_pct()
    assert 0 < cov < 100  # some NOT_AVAILABLE in demo (mcp_catalog, sat)


def test_compliance_maps_findings_to_controls():
    framework = load_framework("dbx-security-best-practices")
    mapper = ComplianceMapper(framework)
    results = mapper.evaluate(demo_findings())
    by_id = {r.control_id: r for r in results}
    # IAM-3 has an open critical finding (SEC-027) -> NOT_MET
    assert by_id["DBX-SBP:IAM-3"].status == ControlStatus.NOT_MET
    # A rule_id-less manual control stays MANUAL
    assert by_id["DBX-SBP:NET-1"].status == ControlStatus.MANUAL


def test_new_core_rules_present():
    reg = RuleRegistry()
    for rid in ("AIG-014", "GOV-025", "AIG-004", "AIG-003"):
        assert reg.get(rid) is not None, rid
    assert reg.get("GOV-025").domain == "governance"
    assert reg.get("AIG-014").domain == "ai_estate"


def test_all_rules_mapped_to_waf_pillars():
    reg = RuleRegistry()
    for r in reg.all():
        assert r.waf_pillars, f"{r.id} is not mapped to any WAF pillar"


def test_by_waf_pillar_lookup():
    reg = RuleRegistry()
    assert reg.get("REL-001") in reg.by_waf_pillar("reliability")
    assert reg.get("FIN-027") in reg.by_waf_pillar("cost_optimization")
    # Operational Excellence and Interoperability & Usability are only covered by
    # cross-cutting rules today (roadmap gap tracked in docs/WAF_GAP_ANALYSIS.md).
    assert len(reg.by_waf_pillar("security")) >= 4


def test_ai_governance_baseline_framework_loads_and_maps():
    fw = load_framework("ai-governance-baseline")
    assert fw.framework == "ai-governance-baseline"
    ids = {c.control_id for c in fw.controls}
    assert {"AIGOV:GUARD-1", "AIGOV:BUDGET-1", "AIGOV:ATTR-1"}.issubset(ids)
    # Manual control has no rule_ids and stays MANUAL.
    mapper = ComplianceMapper(fw)
    results = {r.control_id: r for r in mapper.evaluate(demo_findings())}
    assert results["AIGOV:HUMAN-1"].status == ControlStatus.MANUAL


def test_demo_scan_shape():
    scan = demo_scan()
    assert scan["scan_id"] == "demo-scan-0001"
    assert 0 <= scan["overall_score"] <= 100
    assert len(scan["domains"]) == 9
    assert scan["compliance"]["advisory"] is True
    # per-WAF-pillar sub-scores: one row per pillar, each carrying a mapped-rule count
    assert len(scan["waf_pillars"]) == 7
    sec = next(p for p in scan["waf_pillars"] if p["pillar"] == "security")
    assert sec["rules"] >= 4 and 0 <= sec["score"] <= 100
    # findings are enriched with their rule's pillars for persistence/readback
    assert all("waf_pillars" in f for f in scan["findings"])


def test_waf_pillar_scoring_penalizes_mapped_findings():
    from compass_core.models.finding import Finding, Severity, Status
    from compass_core.scoring import attach_waf_pillars, score_waf_pillars

    findings = attach_waf_pillars([
        Finding(id="F1", rule_id="SEC-027", domain="security",
                title="t", severity=Severity.CRITICAL, resource="r", status=Status.OPEN),
    ])
    by_pillar = {p.pillar: p for p in score_waf_pillars(findings)}
    # SEC-027 maps to security + data_ai_governance -> both take the critical hit
    assert by_pillar["security"].score < 100
    assert by_pillar["data_ai_governance"].score < 100
    # a pillar with no mapped finding stays at 100
    assert by_pillar["reliability"].score == 100.0
