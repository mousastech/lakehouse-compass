"""Genie governance — fleet oversight of Genie spaces for Lakehouse Compass.

Builds a per-space inventory (owner, usage, trend, cost, a setup score and a
usage status) from signals the scan already has access to: the Genie API space
list, ``system.query.history`` (per-space messages/users via
``query_source.genie_space_id``) and Genie billing. Pure builder so every
derived field is unit-tested; the scan job supplies the measured rows.
"""

from .space_inventory import build_space_inventory, setup_score, usage_status

__all__ = ["build_space_inventory", "setup_score", "usage_status"]
