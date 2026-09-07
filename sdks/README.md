# Tracki Mobile SDKs

Native SDKs for Tracki's behavioral-intelligence platform. They all implement
**one** wire protocol — `docs/mobile-wire-protocol.md` — and are kept honest by
**one** set of shared conformance fixtures. The TypeScript `@tracki/mobile-core`
is the reference implementation; the React Native adapter wraps it directly,
while Flutter, iOS and Android re-implement the same protocol natively.

## Protocol-first strategy

There is no separate mobile backend: every SDK talks to the existing public
ingest APIs (`/v1/events`, `/v1/actions`, `/v1/faq`, `/v1/chat`, `/v1/handoff`),
keyed by the project public key (`pk_…`). The server resolves the key to
org/project and masks PII at ingestion. SDKs are **fail-silent** — telemetry must
never break the host app.

Because the contract lives in a document and a fixture set (not in any one
language), all four codebases stay byte-compatible on the wire. When the protocol
changes, the fixtures change, and every SDK's conformance test catches drift.

Shared semantics enforced everywhere:

- **Identity** — `anon_…` persisted forever; `sess_…` rotates after 30 min of
  inactivity (persisted activity stamp); `userId` set by `identify`. Storage keys
  `tracki_anon` / `tracki_user` / `tracki_session` / `tracki_session_ts` /
  `tracki_caps` are shared so an app can migrate SDKs without losing identity.
- **Batching** — flush at 10 events / 5 s / background / terminate; max 50 per
  batch; envelope `{key, anonId, userId?, sessionId, sentAt, device, events}`;
  omitted optionals are **absent** from the JSON (never `null`).
- **Client** — emits the cold `app_foreground` itself at init; `screen(name)`
  emits `screen_leave` (with duration) for the previous screen then `screen_view`
  with the previous path as `referrer`; every event carries the current screen
  `path` and previous-screen `referrer`.
- **Actions / Assist / CTA** — manifest-driven in-app actions with A/B variant
  (stable per-visitor hash), frequency caps, once-per-screen / once-per-session
  rules, a failed render counting as no impression; server-driven Live Assist on
  the events response; and channel routing to url / FAQ / chat / WhatsApp.

## Conformance fixture mechanism

`conformance/journey-batch.json` scripts a deterministic call sequence with a
fixed clock (start `1700000000000`, **+1000 ms before every step**; init happens
at the start value) and an id factory returning `anon_1` / `sess_1`. It carries
the **exact** batch each SDK must POST to `/v1/events`.

`conformance/channel-requests.json` carries the exact `/v1/handoff` and
`/v1/chat` request bodies, captured after the same journey.

Each SDK ships a test that loads these files, replays the journey against a
capturing transport with the injected clock + id factory, and asserts the
produced JSON equals the fixtures **as parsed JSON** (key order is free). The TS
reference asserts the same files in `packages/mobile-core/src/conformance.test.ts`.

## Per-SDK status

| SDK | Path | Language | Test command | Status |
|---|---|---|---|---|
| React Native | (wraps `@tracki/mobile-core`) | TypeScript | `pnpm test` (mobile-core) | **verified** (compile + test in CI) |
| Flutter | `sdks/flutter` | Dart | `dart test` | **source-complete** (not compile-verified) |
| iOS | `sdks/ios` | Swift | `swift test` | **source-complete** (not compile-verified) |
| Android | `sdks/android` | Kotlin | `./gradlew test` | **source-complete** (not compile-verified) |

> **Source-complete, not compile-verified:** the Flutter/Swift/Kotlin SDKs
> implement the protocol and ship conformance tests, but no Flutter/Xcode/Gradle
> toolchain runs in CI yet (tracked follow-up). Until native CI lands, treat the
> TypeScript `@tracki/mobile-core` as the reference of record.

## Layout

```
sdks/
├── conformance/            shared fixtures (journey-batch.json, channel-requests.json)
├── flutter/                tracki_flutter — Dart package (pure-Dart core)
├── ios/                    TrackiSDK — Swift package
├── android/                tracki-android — Kotlin/Gradle module
└── README.md               this file
```

Each SDK directory mirrors the reference's module layout: `types`, `identity`,
`queue`, `client`, `actions`, `assist`, `cta`, `transport`, plus a conformance
test and a README with the event API table.
