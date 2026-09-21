"""compass_core — the Python rule engine, scoring and compliance mapper for
Lakehouse Compass.

Phase 0 ships the data models, a capability manager (with probe stubs), a rule
registry backed by YAML definitions, the weighted scoring model, a compliance
mapper with one shipped framework, and synthetic demo fixtures. Collectors and
the full ~150 rules land in later phases.
"""

__version__ = "0.1.0"

from .scoring import DOMAIN_WEIGHTS, score_domain, overall_score  # noqa: F401
