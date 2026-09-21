# Permissions

## Phase 0 (DEMO_MODE) — minimal
The app renders from bundled fixtures and binds **no App resources**, so the
app service principal needs no data-plane grants to run. Deploying requires the
deployer to have CAN_MANAGE on the app and permission to create the scan job.

## Later phases — least privilege (spec §14)
The Compass app service principal should hold only:
- `SELECT` on System Tables and the `main.lakehouse_compass` schema.
- `CAN USE` on the SQL warehouse (Analytics plugin, Delta reads).
- `CAN QUERY` on the Unity AI Gateway–governed LLM endpoint (Compass Agent).
- A Lakebase role limited to the app schema (no OWNER, no SUPERUSER).
- **No MANAGE / ALL PRIVILEGES anywhere** (Compass scans for exactly this —
  see rule SEC-027, self-check SEC-031).

User authorization (on-behalf-of) is used for the Genie and Serving plugins so
answers respect the user's own Unity Catalog permissions; the app SP is used
only for background reads. User tokens are never forwarded to the browser.

Compass's own SP, endpoint, warehouse and Lakebase role are scanned by the same
rules and surfaced under **Self-check** (Phase 2).
