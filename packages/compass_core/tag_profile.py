"""Tag Profile — semantic roles → the tag keys a deployment actually uses.

Collectors ask the profile "which keys mean *domain* here?" instead of hard-coding
English names, so `dominio_negocio`, `camada` or `certificado` count the same as
`domain`, `layer` or `system.certification_status`. See tag_profile.yaml.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

import yaml

_DEFAULT_PATH = os.path.join(os.path.dirname(__file__), "tag_profile.yaml")

ROLES = ("domain", "layer", "owner", "certification", "sensitivity", "cost_center")

# Substrings that hint at a role for a key the profile does not map yet. Only
# used to *suggest* a mapping in the UI — suggested keys never affect scores.
_SUGGEST_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("certification", ("certif",)),
    ("sensitivity", ("pii", "sensit", "confiden", "classif", "phi", "gdpr", "lgpd")),
    ("owner", ("owner", "steward", "respons", "propiet", "dono")),
    ("layer", ("layer", "camada", "capa", "medallion", "tier")),
    ("domain", ("domain", "dominio", "domínio", "subject", "area", "área", "data_product")),
    ("cost_center", ("cost", "custo", "costo", "team", "business_unit")),
)
_LAYER_VALUES = {"bronze", "silver", "gold", "raw", "curated", "prata", "ouro", "plata", "oro"}


def _norm(values: Any) -> list[str]:
    return sorted({str(v).strip().lower() for v in (values or []) if str(v).strip()})


def sql_str(v: str) -> str:
    return "'" + str(v).replace("\\", "\\\\").replace("'", "\\'") + "'"


def sql_in(values: list[str]) -> str:
    """`IN (...)` list body; never empty (an empty IN is a syntax error)."""
    return ", ".join(sql_str(v) for v in values) if values else "NULL"


@dataclass
class TagProfile:
    keys: dict[str, list[str]] = field(default_factory=dict)
    prefixes: dict[str, list[str]] = field(default_factory=dict)
    certified_values: list[str] = field(default_factory=list)
    deprecated_values: list[str] = field(default_factory=list)
    gold_values: list[str] = field(default_factory=list)
    inherit_exclude: list[str] = field(default_factory=list)

    # -- lookups ---------------------------------------------------------------
    def role_of(self, tag_name: str) -> str | None:
        k = str(tag_name or "").strip().lower()
        for role in ROLES:
            if k in self.keys.get(role, []):
                return role
            if any(k.startswith(p) for p in self.prefixes.get(role, [])):
                return role
        return None

    def suggest_role(self, tag_name: str, values: list[str] | None = None) -> str | None:
        """Best-guess role for an UNMAPPED key (UI hint only)."""
        k = str(tag_name or "").strip().lower()
        if self.role_of(k):
            return None
        vals = {str(v).strip().lower() for v in (values or [])}
        if vals and vals <= _LAYER_VALUES:
            return "layer"
        for role, hints in _SUGGEST_HINTS:
            if any(h in k for h in hints):
                return role
        return None

    def role_case_sql(self, col: str) -> str:
        """SQL CASE mapping a tag-name column to its role (NULL when unmapped)."""
        whens = []
        for role in ROLES:
            conds = []
            if self.keys.get(role):
                conds.append(f"lower({col}) IN ({sql_in(self.keys[role])})")
            for p in self.prefixes.get(role, []):
                conds.append(f"startswith(lower({col}), {sql_str(p)})")
            if conds:
                whens.append(f"WHEN {' OR '.join(conds)} THEN {sql_str(role)}")
        if not whens:
            return "CAST(NULL AS STRING)"
        return "CASE " + " ".join(whens) + " END"

    def to_dict(self) -> dict[str, Any]:
        return {"keys": self.keys, "prefixes": self.prefixes, "certified_values": self.certified_values,
                "deprecated_values": self.deprecated_values, "gold_values": self.gold_values,
                "inherit_exclude": self.inherit_exclude}


def _merge(base: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
    """Union the override's lists into the defaults (an override only adds)."""
    out = json.loads(json.dumps(base))
    for role, spec in (extra.get("roles") or {}).items():
        dst = out.setdefault("roles", {}).setdefault(role, {})
        for k, v in (spec or {}).items():
            if isinstance(v, list):
                dst[k] = list(dst.get(k) or []) + v
    if extra.get("gold_values"):
        out["gold_values"] = list(out.get("gold_values") or []) + list(extra["gold_values"])
    return out


def load_tag_profile(override_json: str | None = None, path: str = _DEFAULT_PATH) -> TagProfile:
    with open(path, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh) or {}
    if override_json and override_json.strip():
        try:
            doc = _merge(doc, json.loads(override_json))
        except (ValueError, TypeError) as e:
            # A malformed override must not silently change scoring — log and keep defaults.
            print(f"[compass] ignoring invalid tag_profile_json: {e}")
    roles = doc.get("roles") or {}
    cert = roles.get("certification") or {}
    return TagProfile(
        keys={r: _norm((roles.get(r) or {}).get("keys")) for r in ROLES},
        prefixes={r: _norm((roles.get(r) or {}).get("prefixes")) for r in ROLES},
        certified_values=_norm(cert.get("certified_values")),
        deprecated_values=_norm(cert.get("deprecated_values")),
        gold_values=_norm(doc.get("gold_values")),
        inherit_exclude=[r for r in _norm(doc.get("inherit_exclude")) if r in ROLES],
    )
