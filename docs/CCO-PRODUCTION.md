# Internal CCO collector deployment

`Dockerfile.cco` runs the authenticated CCO ingestion routes against a dedicated PostgreSQL database. It is a production collector for the internal Tracki/Watchtower bridge; it does not mount public snippet collection, Live Assist, AI, Redis, or ClickHouse analytics. The application's authenticated browser endpoint forwards privacy-filtered browser batches using its own server credential. Accepted browser evidence and its CCO projection are committed atomically. Analytics inbox work remains explicitly pending because no analytics worker runs in this service.

Required variables: `NODE_ENV=production`, `DATABASE_URL`, `TRACKI_CCO_ENABLED=true`, `TRACKI_CCO_READ_KEY`, and `TRACKI_CCO_PROJECTS_JSON`. Use a distinct random producer key for each configured application/environment project and a separate reader key. Project metadata comes from this server configuration; browser identifiers never establish account authority.

`TRACKI_CCO_RETENTION_DAYS` defaults to 30 (allowed 1–90). Startup and hourly retention remove expired evidence and inbox identities older than the retention window; health fails when retention fails. A 30-day purge also ends duplicate-ID protection for those purged IDs. Producer retries expire within 24 hours. Use service-owned database credentials; never share Control Plane or MDP write credentials.

`/health` checks database connectivity and retention execution, and reports `analyticsWorker: not-enabled`. This is collector availability, not customer account health or successful business outcomes. All ingest/read routes require their respective server-only bearer credentials. The service intentionally exposes no browser CORS endpoint.

Use `railway.cco.json` as the service config file and deploy an immutable Git revision. Configure HTTPS, review scoped project mappings, and connect Watchtower with the reader key. Rollout proof must distinguish deployment canary observations from actual authenticated customer activity. Never synthesize a customer identity for a canary.
