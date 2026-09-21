"""Usage & Adoption collector (spec §6.H).

- active users (30d) + WAU/MAU/DAU from system.query.history
- weekly active-users + Genie-users trend (usage_active_users_trend)
- Genie usage split by surface via system.query.history.client_application:
  'Databricks SQL Genie Space' = Genie Agents/One. Genie Code is only reported
  when a distinguishing client_application value exists — otherwise the split is
  NOT_AVAILABLE (never fabricated).
- USG-010 when activity concentrates in a single identity.
"""

from __future__ import annotations

from ..models.capability import Availability
from ..models.finding import Finding, Severity
from .base import CollectorResult, SparkLike, cap, rows_as_dicts

GENIE_AGENTS_APP = "Databricks SQL Genie Space"
# client_application values that would denote the Genie Code coding agent.
GENIE_CODE_APPS = ("Genie Code", "Databricks Genie Code")


class UsageCollector:
    domain = "usage"

    def __init__(self, workspace_id: str, window_days: int = 30, scan_id: str = "live", workspace_name: str = ""):
        self.workspace_id = workspace_id
        self.workspace_name = workspace_name
        self.window_days = window_days
        self.scan_id = scan_id

    def collect(self, spark: SparkLike) -> CollectorResult:
        res = CollectorResult()
        ws, wd = self.workspace_id, self.window_days
        active_users = 0
        try:
            u = rows_as_dicts(spark, f"SELECT COUNT(DISTINCT user_identity.email) AS users FROM system.access.audit WHERE workspace_id='{ws}' AND event_date>=DATEADD(DAY,-{wd},CURRENT_DATE())")
            active_users = int(u[0]["users"]) if u else 0
            res.capabilities.append(cap("access", "system.access.audit", Availability.AVAILABLE))
        except Exception as e:  # pragma: no cover
            res.capabilities.append(cap("access", "system.access.audit", Availability.NOT_AVAILABLE, str(e)[:200]))

        heatmap: list[dict] = []
        concentration = 0.0
        wau = mau = dau = 0
        genie_users = genie_statements = 0
        genie_code_users = genie_code_statements = 0
        genie_code_available = False
        trend_rows: list[dict] = []
        try:
            qh = "system.query.history"
            base = f"FROM {qh} WHERE workspace_id='{ws}'"
            heat = rows_as_dicts(spark, f"""
                SELECT CAST(dayofweek(start_time) AS INT) AS dow, CAST(hour(start_time) AS INT) AS hour, COUNT(*) AS n
                {base} AND start_time>=DATEADD(DAY,-{wd},CURRENT_DATE()) GROUP BY 1,2 """)
            heatmap = [{"scan_id": self.scan_id, "workspace_id": ws, "dow": int(r["dow"]), "hour": int(r["hour"]), "n": int(r["n"])} for r in heat]

            byid = rows_as_dicts(spark, f"SELECT executed_by AS e, COUNT(*) AS n {base} AND start_time>=DATEADD(DAY,-{wd},CURRENT_DATE()) GROUP BY 1 ORDER BY n DESC")
            total_q = sum(int(r["n"]) for r in byid) or 1
            concentration = round(100.0 * int(byid[0]["n"]) / total_q, 1) if byid else 0.0

            w = rows_as_dicts(spark, f"""
                SELECT
                  COUNT(DISTINCT CASE WHEN start_time>=DATEADD(DAY,-1,CURRENT_DATE()) THEN executed_by END) AS dau,
                  COUNT(DISTINCT CASE WHEN start_time>=DATEADD(DAY,-7,CURRENT_DATE()) THEN executed_by END) AS wau,
                  COUNT(DISTINCT CASE WHEN start_time>=DATEADD(DAY,-30,CURRENT_DATE()) THEN executed_by END) AS mau
                {base} """)
            dau, wau, mau = int(w[0]["dau"]), int(w[0]["wau"]), int(w[0]["mau"])

            # Genie surface split via client_application.
            g = rows_as_dicts(spark, f"""
                SELECT client_application AS app, COUNT(*) AS n, COUNT(DISTINCT executed_by) AS users
                {base} AND start_time>=DATEADD(DAY,-{wd},CURRENT_DATE()) AND client_application IS NOT NULL
                  AND client_application ILIKE '%genie%'
                GROUP BY 1 """)
            for r in g:
                app = str(r["app"])
                if any(c.lower() in app.lower() for c in GENIE_CODE_APPS):
                    genie_code_available = True
                    genie_code_statements += int(r["n"])
                    genie_code_users = max(genie_code_users, int(r["users"]))
                else:
                    genie_statements += int(r["n"])
                    genie_users = max(genie_users, int(r["users"]))

            # Weekly active-users + Genie-users trend (last ~10 weeks).
            tr = rows_as_dicts(spark, f"""
                SELECT CAST(date_trunc('WEEK', start_time) AS DATE) AS wk,
                       COUNT(DISTINCT executed_by) AS active_users,
                       COUNT(DISTINCT CASE WHEN client_application='{GENIE_AGENTS_APP}' THEN executed_by END) AS genie_users
                {base} AND start_time>=DATEADD(WEEK,-10,CURRENT_DATE()) GROUP BY 1 ORDER BY 1 """)
            trend_rows = [{"scan_id": self.scan_id, "workspace_id": ws, "period_start": str(r["wk"]),
                           "active_users": int(r["active_users"]), "genie_users": int(r["genie_users"] or 0)} for r in tr]
            res.capabilities.append(cap("query", "system.query.history", Availability.AVAILABLE))
        except Exception as e:  # pragma: no cover
            res.capabilities.append(cap("query", "system.query.history", Availability.NOT_AVAILABLE, str(e)[:200]))

        res.inventory["usage_heatmap"] = heatmap
        res.inventory["usage_active_users_trend"] = trend_rows
        adoption = round(100.0 * genie_users / mau, 1) if mau else 0.0
        res.inventory["usage_summary"] = [
            {"scan_id": self.scan_id, "workspace_id": ws, "metric": "active_users_30d", "value": float(active_users)},
            {"scan_id": self.scan_id, "workspace_id": ws, "metric": "dau", "value": float(dau)},
            {"scan_id": self.scan_id, "workspace_id": ws, "metric": "wau", "value": float(wau)},
            {"scan_id": self.scan_id, "workspace_id": ws, "metric": "mau", "value": float(mau)},
            {"scan_id": self.scan_id, "workspace_id": ws, "metric": "top_identity_share_pct", "value": float(concentration)},
            {"scan_id": self.scan_id, "workspace_id": ws, "metric": "genie_users", "value": float(genie_users)},
            {"scan_id": self.scan_id, "workspace_id": ws, "metric": "genie_statements", "value": float(genie_statements)},
            {"scan_id": self.scan_id, "workspace_id": ws, "metric": "genie_adoption_pct", "value": float(adoption)},
            {"scan_id": self.scan_id, "workspace_id": ws, "metric": "genie_code_available", "value": 1.0 if genie_code_available else 0.0},
            {"scan_id": self.scan_id, "workspace_id": ws, "metric": "genie_code_statements", "value": float(genie_code_statements)},
        ]

        if concentration >= 60.0:
            res.findings.append(Finding(
                id=f"{self.scan_id}-USG-010", rule_id="USG-010", domain="usage",
                title="Query activity concentrated in a single identity", severity=Severity.LOW,
                resource=f"workspace: {self.workspace_id}",
                evidence={"top_identity_share_pct": concentration, "active_users_30d": active_users, "wau": wau, "mau": mau},
                remediation="Broaden enablement across teams; confirm SP-driven workloads are attributed.",
                scan_id=self.scan_id, workspace_id=self.workspace_id, workspace_name=self.workspace_name,
            ))
        return res
