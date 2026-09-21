# Deployment

## Environment note (important)
On the build machine the public npm/pypi registries are blocked, so the app
**cannot be built locally**. It self-builds on the Databricks Apps compute via
`app/app.yaml`:
```yaml
command:
  - sh
  - -c
  - 'if [ ! -d node_modules ]; then npm ci || npm install; fi; npm run build && npm start'
```
Deploy with DAB (which uploads source and lets the platform build), **not**
`databricks apps deploy` (which type-checks locally and fails without
`node_modules`).

## Steps
```bash
PROFILE=fevm-moi-ai

# 1. Validate
databricks bundle validate -t dev --profile $PROFILE

# 2. Deploy (uploads source, creates the app + scan job)
databricks bundle deploy -t dev --profile $PROFILE

# 3. Start / deploy the app (triggers the on-compute build)
databricks bundle run compass_app -t dev --profile $PROFILE

# 4. Watch the build (look for [BUILD] then the server listening)
databricks apps logs lakehouse-compass --profile $PROFILE

# 5. Get the URL + state
databricks apps get lakehouse-compass --profile $PROFILE
```

## Targets
- `dev` (default, `mode: development`, per-user root_path) — Phase 0 work.
- `staging`, `prod` — shared root_path; `prod` is `mode: production`.

## Resources
Phase 0 binds none. To go live later, uncomment the resources block in
`resources/app.yml` (SQL warehouse, Lakebase `postgres`, `compass-llm` serving
endpoint), add the matching plugins in `app/server/server.ts`, set
`COMPASS_DEMO_MODE=false` in `app/app.yaml`, and redeploy.

## Scan job
`databricks bundle run compass_scan -t dev --profile $PROFILE` runs the demo
scan on serverless and writes `main.lakehouse_compass.*` Delta tables. The
weekly schedule ships PAUSED.
