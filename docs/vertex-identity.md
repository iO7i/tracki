# Vertex identity progression

Durable, privacy-safe identity ladder for the tryvertex.io tenant. **Email is never
an analytics identifier.** Every ID below is an opaque first-party surrogate.

```
anonymous_visitor_id → lead_id → user_id → organization_id → store_id
```

## How each rung is established

| Rung | Source | Carried into Tracki as | Established on |
|------|--------|------------------------|----------------|
| `anonymous_visitor_id` | Tracki snippet (`anon_*`, first-party cookie/localStorage) | batch envelope `anonId` | first page view |
| `lead_id` | Vertex CRM | event prop `leadId` | `booking_started` / `booking_completed` |
| `user_id` | Vertex auth | `tracki.identify(userId)` **+** event prop `userId` | `signup_completed` / `booking_completed` (a real first-party conversion) |
| `organization_id` | Vertex platform | event prop `orgId` | post-signup (`trial_started`, `store_connected`, …) |
| `store_id` | Zid/Salla connection | event prop `storeId` | `store_connected` onward |

## The merge rule

The **anon → user merge** is the only identity write Tracki performs. It happens
exclusively when Vertex calls `tracki.identify(userId, …)`, which the client does
**only on a legitimate first-party conversion** — `booking_completed`,
`signup_completed`, or authenticated account creation. Never on anonymous
browsing, and never with an email.

Mechanically (already implemented, tenant-neutral):

1. `identify(userId)` flushes the anonymous buffer first (pre-login events keep
   their acquisition attribution — Audit N3), then sets the batch `userId`.
2. Ingest upserts `identities(project_id, anon_id, user_id)`
   (`apps/ingest/src/pg.ts` → `ON CONFLICT (project_id, anon_id) DO UPDATE`), so
   the pre-login anonymous timeline and the post-login user stitch into one
   visitor history.

`lead_id`, `organization_id`, and `store_id` are **dimensions**, not merge keys:
they ride as allowlisted event props (`@tracki/shared` `VERTEX_PROP_KEYS`) and are
used to segment/filter the funnel, not to re-identify the visitor. This keeps the
identity graph a simple anon↔user mapping while still answering
"which org / which store" for any activation event.

## Privacy guarantees

- `userId` passed to `identify` is Vertex's opaque UUID — if an email is ever
  passed by mistake, the ingestion edge masks it (`sanitizeVertexTrack` +
  `maskPii`) before storage.
- No raw email/phone/name/token/order data is ever a prop (dropped by the
  allowlist at ingest — see `packages/shared/src/vertex.ts`).
- The merge is one-directional and idempotent; re-running `identify` with the
  same pair is a no-op.
