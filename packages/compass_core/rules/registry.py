"""Rule registry. Loads rule definitions from YAML under definitions/ and
provides lookup by id, domain and framework."""

from __future__ import annotations

import os
from typing import Iterable

import yaml

from ..models.rule import Rule

_DEFINITIONS_DIR = os.path.join(os.path.dirname(__file__), "definitions")


def load_rules(directory: str | None = None) -> list[Rule]:
    directory = directory or _DEFINITIONS_DIR
    rules: list[Rule] = []
    for name in sorted(os.listdir(directory)):
        if not name.endswith((".yaml", ".yml")):
            continue
        with open(os.path.join(directory, name), "r", encoding="utf-8") as fh:
            doc = yaml.safe_load(fh) or {}
        entries = doc.get("rules", doc if isinstance(doc, list) else [])
        for entry in entries:
            rules.append(Rule.from_dict(entry))
    return rules


class RuleRegistry:
    def __init__(self, rules: Iterable[Rule] | None = None):
        self._rules: dict[str, Rule] = {}
        for r in rules or load_rules():
            self._rules[r.id] = r

    def __len__(self) -> int:
        return len(self._rules)

    def all(self) -> list[Rule]:
        return list(self._rules.values())

    def get(self, rule_id: str) -> Rule | None:
        return self._rules.get(rule_id)

    def by_domain(self, domain: str) -> list[Rule]:
        return [r for r in self._rules.values() if r.domain == domain]

    def by_framework(self, control_prefix: str) -> list[Rule]:
        return [
            r
            for r in self._rules.values()
            if any(c.startswith(control_prefix) for c in r.frameworks)
        ]

    def by_waf_pillar(self, pillar: str) -> list[Rule]:
        return [
            r
            for r in self._rules.values()
            if any(p.value == pillar for p in r.waf_pillars)
        ]
