# Tracki

Behavioral intelligence for websites and mobile applications.

Created by **Hosam Talbi**.

Tracki was developed privately from June–July 2026 and published as a cleaned public snapshot in September 2026.

Tracki connects customer behavior to timely assistance. It detects friction such as repeated payment failures, OTP loops, rage clicks, and abandoned onboarding, then delivers contextual help through web interfaces, mobile experiences, or WhatsApp. An Arabic and English dashboard brings customer journeys, interventions, and outcomes together.

```text
browser / mobile SDKs
        ↓ shared event protocol
durable ingestion inbox → friction detectors → contextual interventions
        ↓                         ↓                    ↓
   PostgreSQL                 ClickHouse          web / mobile / WhatsApp
        └────────────── journeys, outcomes, review-gated knowledge ──────┘
```

## Capabilities

- **Behavioral analytics:** first-party event collection, live activity, visitor timelines, saved segments, and friction scoring.
- **Contextual interventions:** targeted popups, banners, tooltips, mobile tours, and help drawers with scheduling, frequency caps, and A/B variants.
- **Knowledge and support:** Arabic-aware FAQ retrieval, citation-grounded chat, and WhatsApp handoff with conversation context and human takeover.
- **Knowledge improvement:** recurring unanswered questions inform FAQ drafts; proposed content and actions require review before publication.
- **Outcome reporting:** revenue-at-risk estimates and intervention recovery analysis, with correlation distinguished from causal attribution.
- **Arabic and English:** localized interfaces, right-to-left layouts, and Arabic text normalization.

## Architecture

Tracki is a TypeScript monorepo managed with pnpm and Turborepo. Web and mobile clients share an ingestion protocol and processing pipeline.

| Component | Responsibility |
| --- | --- |
| `apps/dashboard` | Next.js dashboard, authentication, administration, and analytics |
| `apps/ingest` | Fastify API, event processing, friction detection, and assistance |
| `packages/snippet` | Browser tracking and intervention rendering |
| `packages/mobile-core` | Shared mobile event, session, and action engine |
| `packages/sdk-react-native` | React Native integration |
| `sdks` | Flutter, Swift, and Kotlin integrations and protocol fixtures |
| `packages/ai` | Retrieval, conversational assistance, and content proposals |
| `packages/whatsapp` | Meta Cloud API integration and local simulator |
| `packages/shared` | Event contracts, privacy masking, normalization, and scoring |

PostgreSQL stores application data, the durable telemetry inbox, and transactional detector state. ClickHouse stores behavioral events and detections; Redis supports caching, rate limits, and best-effort live updates. Docker Compose provides local infrastructure.

## One-command proof

After the local dependencies are running, run:

```sh
pnpm test
```

The proof surface includes stable event IDs, ingestion-time masking, durable acceptance, retry behavior, detector state, mobile protocol conformance, and an integration path that injects a delivery failure before a real API retry. The repository does not claim lossless client telemetry or causal attribution; those boundaries are documented below.

## Run locally

Requirements: Node.js 20 or later, pnpm 9, and Docker with Compose.

```sh
git clone https://github.com/iO7i/tracki.git
cd tracki
corepack enable
pnpm install --frozen-lockfile
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate
pnpm ch:migrate
pnpm dev
```

The dashboard normally runs at `http://localhost:3000`, the ingestion API at `http://localhost:4000`, and the demo at `http://localhost:4321`. Use the included environment templates when overriding local service settings.

Local development supports a deterministic language-model fallback and a WhatsApp simulator. Set `ANTHROPIC_API_KEY` to enable the hosted language-model integration. Real WhatsApp messaging requires Meta Cloud API credentials. See [Deployment](docs/DEPLOY.md) for production configuration.

## Verification

```sh
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

CI also runs the infrastructure regression suite against PostgreSQL, Redis, and ClickHouse service containers, followed by Chromium Playwright tests against the built dashboard and ingestion API. Run the infrastructure suite with `pnpm --filter @tracki/ingest exec vitest run --config vitest.integration.config.ts` against a dedicated test database. It creates telemetry fixtures and deliberately terminates a worker database connection. Playwright runs with `pnpm e2e` against the running stack; it includes an injected delivery failure followed by a real API retry. Exploratory checks under `apps/ingest/bench` are separate from the regression suite.

## Scope and limitations

Tracki is a portfolio implementation with web and mobile functionality. Flutter, Swift, and Kotlin SDK sources include protocol fixtures but have not been compile-verified with native toolchains; see their individual READMEs. Revenue figures depend on configured order values and conversion events and represent estimates or observed correlations. Citation and escalation controls reduce unsupported answers but do not establish a universal accuracy guarantee.

Tenant-scoped access and ingestion-time masking are part of the implementation. Deployment requires appropriate credentials, infrastructure configuration, and validation for the intended environment.

Telemetry delivery uses stable client event IDs and a durable acceptance ledger. Event-time windows preserve batched timing; arrivals older than the processed visitor watermark are stored without retroactive detection. Browser persistence is bounded and consent-gated, not a lossless archive. See [Reliability and operations](docs/RELIABILITY.md) for retry guarantees, legacy-client compatibility, retention, migration cutover, and remaining limitations. Existing deployments must follow the cutover procedure before upgrading.

## Documentation

- [Deployment](docs/DEPLOY.md)
- [Reliability and operations](docs/RELIABILITY.md)
- [Mobile wire protocol](docs/mobile-wire-protocol.md)
- [Mobile SDK overview](sdks/README.md)
- [React Native SDK](packages/sdk-react-native/README.md)
