# @io7i/tracki-mobile-core

Headless, dependency-free native diagnostic queue and protocol engine. Platform storage, transport and clock are injected. The React Native adapter is `@io7i/tracki-react-native` at the matching exact version.

Collection starts disabled. Native app authority must be established through the authenticated CCO bridge. Events snapshot identity, verified scope, build and protocol when created. Logout/reset purges the tenant outbox and counters. No screen, input, raw stack or request-body capture is provided.

The persistent outbox retains explicit event IDs until an exact collector receipt is durably stored. Retryable failures use bounded exponential backoff with jitter. Permanent rejections are counted and removed, never retried forever. Capacity/expiry/storage/sampling losses remain visible through `queueHealth()`.

`collectionBudget` configures safe capped storage, TTL, batch and routine-success sampling. Errors, failed requests and unusual latency are unsampled; capacity eviction prefers routine successes. Sampling weights are recorded per event. Missing evidence must never be interpreted as no incident.

Private installation uses `@io7i:registry=https://npm.pkg.github.com`, a repository-authorized environment-backed read credential and an exact lockfile. Production consumers need no local `file:` path or unpublished shared runtime dependency.

Unit/source checks do not establish Android/iOS binary or physical-device acceptance. Those require the representative app's real authentication, backend authority and device journeys.

Sampled-out/invalid-observation counter writes coalesce within one second and are forced by `flush()` and explicit health reports. A terminal process kill can lose that last in-memory counter interval; it is not complete observation. Queued event persistence remains immediate. Binary/runtime/update changes rotate the current session while retaining historical batch identities and grants.
