"""Compliance mapper (spec §7).

Maps rules/findings to framework controls and computes per-control status:
MET | PARTIAL | NOT_MET | NOT_MEASURABLE | MANUAL, with linked findings as
evidence. Framework mappings are advisory (spec principle §2.13)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import yaml

from ..models.finding import Finding, Status

_FRAMEWORKS_DIR = os.path.join(os.path.dirname(__file__), "frameworks")


class ControlStatus(str, Enum):
    MET = "MET"
    PARTIAL = "PARTIAL"
    NOT_MET = "NOT_MET"
    NOT_MEASURABLE = "NOT_MEASURABLE"
    MANUAL = "MANUAL"


@dataclass
class Control:
    control_id: str
    title: str
    description: str
    category: str
    rule_ids: list[str] = field(default_factory=list)
    manual: bool = False
    attestation: str = ""


@dataclass
class Framework:
    framework: str
    title: str
    version: str
    advisory: bool
    controls: list[Control] = field(default_factory=list)


@dataclass
class ControlResult:
    control_id: str
    title: str
    category: str
    status: ControlStatus
    linked_findings: list[str] = field(default_factory=list)


def load_framework(name: str, directory: str | None = None) -> Framework:
    directory = directory or _FRAMEWORKS_DIR
    path = os.path.join(directory, f"{name}.yaml")
    with open(path, "r", encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    controls = [
        Control(
            control_id=c["control_id"],
            title=c["title"],
            description=c.get("description", ""),
            category=c.get("category", ""),
            rule_ids=list(c.get("rule_ids", [])),
            manual=bool(c.get("manual", False)),
            attestation=c.get("attestation", ""),
        )
        for c in doc.get("controls", [])
    ]
    return Framework(
        framework=doc["framework"],
        title=doc["title"],
        version=str(doc.get("version", "")),
        advisory=bool(doc.get("advisory", True)),
        controls=controls,
    )


class ComplianceMapper:
    def __init__(self, framework: Framework):
        self.framework = framework

    def evaluate(
        self,
        findings: list[Finding],
        evaluated_rule_ids: set[str] | None = None,
    ) -> list[ControlResult]:
        """Compute status per control from the current findings.

        A control is MET when all its rules were evaluated and none produced an
        OPEN finding; NOT_MET when any rule has an OPEN finding; PARTIAL when
        some but not all mapped rules were evaluable; NOT_MEASURABLE when none
        were; MANUAL for attestation-only controls.
        """
        by_rule: dict[str, list[Finding]] = {}
        for f in findings:
            by_rule.setdefault(f.rule_id, []).append(f)

        results: list[ControlResult] = []
        for c in self.framework.controls:
            if c.manual:
                results.append(
                    ControlResult(c.control_id, c.title, c.category, ControlStatus.MANUAL)
                )
                continue

            if not c.rule_ids:
                results.append(
                    ControlResult(c.control_id, c.title, c.category, ControlStatus.NOT_MEASURABLE)
                )
                continue

            open_findings: list[str] = []
            measurable_rules = 0
            for rid in c.rule_ids:
                rule_findings = by_rule.get(rid, [])
                measurable = (
                    evaluated_rule_ids is None or rid in evaluated_rule_ids
                ) and not any(f.status == Status.NOT_MEASURABLE for f in rule_findings)
                if measurable:
                    measurable_rules += 1
                open_findings.extend(
                    f.id for f in rule_findings if f.status == Status.OPEN
                )

            if measurable_rules == 0:
                status = ControlStatus.NOT_MEASURABLE
            elif open_findings:
                status = ControlStatus.NOT_MET
            elif measurable_rules < len(c.rule_ids):
                status = ControlStatus.PARTIAL
            else:
                status = ControlStatus.MET

            results.append(
                ControlResult(c.control_id, c.title, c.category, status, open_findings)
            )
        return results

    def coverage_summary(self, results: list[ControlResult]) -> dict[str, Any]:
        counts: dict[str, int] = {s.value: 0 for s in ControlStatus}
        for r in results:
            counts[r.status.value] += 1
        total = len(results) or 1
        return {
            "framework": self.framework.framework,
            "total": len(results),
            "met": counts["MET"],
            "partial": counts["PARTIAL"],
            "not_met": counts["NOT_MET"],
            "not_measurable": counts["NOT_MEASURABLE"],
            "manual": counts["MANUAL"],
            "met_pct": round(100.0 * counts["MET"] / total, 1),
            "advisory": self.framework.advisory,
        }
