# Tracki Mobile Wire Protocol (v1, implementation

The **normative** contract every Tracki mobile SDK implements. The TypeScript
reference implementation is `@tracki/mobile-core` (verified by unit tests, the
shared conformance fixtures in `sdks/conformance/`, and the `mobile-check.mjs`
bench against the real ingest stack). Flutter/Swift/Kotlin SDKs implement this
document and assert the same fixtures.

All endpoints are the **existing** public ingest APIs — there is no separate
mobile backend. Everything is keyed by the project public key (`pk_…`); the
server resolves it to org/project (multi-tenant isolation) and masks PII at
ingestion. SDKs MUST be fail-silent: telemetry must never break the host app.

## 1. Identity & sessions

- `anonId` — `anon_<uuid>`; generated once, persisted forever (AsyncStorage /
  SharedPreferences / UserDefaults).
- `sessionId` — `sess_<uuid>`; rotates after **30 minutes of inactivity**
  (any tracked event = activity). Persisted with a `tracki_session_ts`
  last-activity stamp so an idle-expired session rotates across launches.
- `userId` — set by `identify(userId)`; persisted; sent on every batch after.
  Identification also emits an `identify` event (the server links identities).

Storage keys (shared across SDKs so an app migrating SDKs keeps identity):
`tracki_anon`, `tracki_user`, `tracki_session`, `tracki_session_ts`,
`tracki_caps` (frequency-cap JSON map).

## 2. Event batching — `POST {endpoint}/v1/events`

Queue events; flush when **10 buffered** or **5 s** elapsed or the app
backgrounds/terminates. Max **50 events per batch** (split larger). The server
always answers `202` with a JSON body; it never reveals key validity.

```json
{
  "key": "pk_…",
  "anonId": "anon_…",
  "userId": "user_…",            // omit when anonymous
  "sessionId": "sess_…",
  "sentAt": 1700000000000,        // ms epoch at flush
  "device": {
    "platform": "ios",           // "ios" | "android"   (REQUIRED for mobile)
    "osVersion": "17.4",         // ≤32 chars
    "appVersion": "2.1.0",       // ≤32 chars — drives revenue-by-app-version
    "model": "iPhone15,2",       // ≤64 chars
    "sdk": "react-native"        // "react-native" | "flutter" | "ios" | "android"
  },
  "events": [ { "type": "…", "ts": 1700000000000, "path": "/Checkout",
                "referrer": "/Home", "props": { } } ]
}
```

- `path` = the **current screen** as `/<ScreenName>` (whitespace → `-`). Screen
  names like "Checkout"/"Payment" naturally rank as high-intent paths server-side.
- `referrer` = the previous screen's path (omit on the first screen).
- `props` ≤ 8192 bytes serialized; strings ≤ 2048 chars. PII in props is masked
  server-side, but SDKs SHOULD NOT collect PII in the first place.

### Event vocabulary (mobile)

| type | when | props |
|---|---|---|
| `screen_view` | screen shown | custom |
| `screen_leave` | leaving a screen | `durationMs` |
| `app_foreground` | app activated | `launch`: `"cold"` (process start — the SDK emits this itself at init) or `"warm"` |
| `app_background` | app deactivated | `durationMs` (time on current screen) |
| `app_terminate` | best-effort on kill | — |
| `deep_link` | link opened the app | `url`, `ok` (false ⇒ failed to resolve — fires `deep_link_failure`) |
| `push_open` | notification opened | custom (e.g. `campaign`) |
| `back_nav` | OS/app back navigation | — |
| `otp_start` / `otp_fail` / `otp_success` | OTP entry | custom |
| `biometric_start` / `biometric_fail` / `biometric_success` | Face/Touch ID etc. | custom |
| `payment_start` / `payment_fail` / `payment_complete` | payment attempt | `method` (e.g. `"mada"`) |
| `flow_start` / `flow_complete` / `flow_abandon` | named funnel | `flow`: `checkout` \| `registration` \| `loan` \| `kyc` \| `onboarding` \| custom |
| `error` | app-level error worth tracking | `message` |
| `track` | custom event | `name` + custom |
| `identify` | after `identify(userId)` | — |

Server-side struggle detection over these (no client detector needed):
otp_failure_loop (2 fails/5 min), biometric_failure_loop (2/5 min),
repeated_payment_failure (2/10 min), app_restart_loop (3 cold starts/10 min,
per visitor), rapid_screen_switching (6 screens/30 s), repeated_back_navigation
(4/30 s), permission_denial_loop (2 same-permission/10 min),
deep_link_failure (1, debounced), onboarding_abandonment (flow_abandon of
onboarding/registration, debounced).

## 3. Actions — `GET {endpoint}/v1/actions?key=…&surface=mobile`

Fetch once at SDK init (the server caches ~30 s). Entries: `id`, `type`
(`popup`→in-app modal, `banner`, `tooltip`, `tour` with `steps[]`, `drawer`),
bilingual `content`/`contentB` (`{ar,en} × {title, body, cta?}`), `trigger`,
`urlContains`, `frequencyCap`, `goalEvent`, `anchorSelector`, `steps`.

Trigger mapping on mobile:

| manifest trigger | mobile meaning |
|---|---|
| `pageview` | on `screen_view` (re-evaluated per screen; `urlContains` matches the screen path) |
| `time_on_page` | timer armed at manifest load (`seconds`), checked against `urlContains` at fire |
| `exit_intent` | on `app_background` |
| `event` | on `track(eventName)` |
| `rage_click` | not applicable on mobile (no DOM) — never fires |
| `struggle` | **server-driven** — never in the manifest; arrives as Live Assist (§4) |

Rules (identical to the web snippet):
- A/B: variant = stable hash `anonId:actionId` (see `pickVariant`), reported on
  every action event.
- Frequency cap: persisted impression count per action (`tracki_caps`).
- Once per screen, re-armed on screen change; once per session for goals.
- A failed render MUST NOT count: no impression event, no cap bump, no goal arm.
- Telemetry events: `action_impression`, `action_click` (props.channel =
  url/faq/chat/whatsapp), `action_dismiss`, `action_goal` — all with
  `props.action_id` + `props.variant`.

## 4. Live Assist (server-driven struggles)

The `/v1/events` response MAY carry `{ "assist": AssistPayload }` — the server
matched a just-detected struggle to a Live Assist action (and possibly a
grounded FAQ). Render as a contextual sheet/drawer:

- `mode: "answer"` → show `article[locale]` title/body + "was this helpful?"
  (emit `assist_helpful` / `assist_unhelpful`; unhelpful SHOULD offer the chat).
- `mode: "fallback"` → show `content[locale]` title/body.
- The authored `content[locale].cta` is the escalate CTA → emit
  `assist_escalate` and route by channel (§5).
- Telemetry props: `action_id`, `article_id?`, `mode`. Emit `assist_shown` on
  render. Show each assist at most once per session.

## 5. Channel CTAs ("right channeling")

`cta.kind` ∈ `url | faq | chat | whatsapp` (legacy: `faq: true` ⇒ faq; absent ⇒
url). Routing:

- `url` — open `cta.url` (http/https only) in the system browser.
- `faq` — `GET /v1/faq?key=…&q=…` → render the article list natively.
- `chat` — `POST /v1/chat` `{key, anonId, sessionId, userId?, conversationId?,
  message, path}` → `{conversationId, reply, citation?, escalate}`; keep
  `conversationId` for the next turn.
- `whatsapp` — `POST /v1/handoff` `{key, anonId, sessionId, path, locale,
  platform}` → `{deepLink: "https://wa.me/…"}`; open the deep link (https
  only). `platform` is the device platform (`ios`/`android`) so the operator
  inbox can label the surface. The server mints an inquiry code and snapshots
  masked context for the team inbox.

## 6. Conformance

`sdks/conformance/journey-batch.json` — a scripted call sequence with a
deterministic clock (start 1700000000000, +1000 ms before every script step)
and id factory (`anon_1`, `sess_1`); the file contains the **exact batch** the
SDK must POST. `channel-requests.json` — the exact `/v1/handoff` and `/v1/chat`
request bodies. Compare as parsed JSON (not strings — key order is free).
`@tracki/mobile-core` asserts both in `conformance.test.ts`; each native SDK
ships a test doing the same.

Status note: the TS reference + RN adapter are compile- and test-verified in
CI; the Flutter/Swift/Kotlin SDKs are **source-complete, not compile-verified**
(no native toolchain in CI yet — tracked follow-up).
