# TrackiSDK (iOS / Swift)

Swift port of `@tracki/mobile-core` — the headless protocol engine for Tracki's
behavioral-intelligence platform. Swift concurrency (async/await), zero
third-party dependencies; storage / transport / clock / id-factory are injected.

> **Status: source-complete, NOT compile-verified** — this SDK implements
> `docs/mobile-wire-protocol.md` and ships conformance tests against
> `sdks/conformance/`, but no Flutter/Xcode/Gradle toolchain runs in CI yet.
> Treat the TypeScript `@tracki/mobile-core` as the reference until native CI
> lands.

## Quickstart

```swift
import TrackiSDK

let tracki = await Tracki.create(TrackiConfig(
    key: "pk_live_xxx",
    endpoint: "https://ingest.tracki.app",
    device: DeviceInfo(
        platform: "ios",
        osVersion: "17.4",
        appVersion: "2.1.0",
        model: "iPhone15,2",
        sdk: "ios"
    ),
    storage: UserDefaultsStorage(),       // default persistence on Apple OSes
    locale: "ar",                          // Arabic-first; "en" also supported
    renderer: MyRenderer(),                // draws popups/assist/faq/chat natively
    openUrl: { url in UIApplication.shared.open(URL(string: url)!) }
))

// Tab a screen — emits screen_leave (with duration) + screen_view.
tracki.screen("Checkout")
tracki.payment("fail", props: ["method": "mada"])
tracki.identify("user_42")
await tracki.flush()
```

The SDK emits the cold `app_foreground` itself at construction (drives the
server's `app_restart_loop` detection). Tracking calls are synchronous and
fail-silent; network flushes happen in the background and never throw into the
host app. Wire bodies are `[String: Any]` serialized with `JSONSerialization`,
so omitted/optional fields are **absent** from the JSON (never `null`).

## Event API

| Method | Emits | Props |
|---|---|---|
| `screen(_:props:)` | `screen_leave` (prev) + `screen_view` | `durationMs` on leave; custom on view |
| `appForeground(_:)` | `app_foreground` | `launch` (`"warm"` default; `"cold"` auto at init) |
| `appBackground()` | `app_background` (+ exit-intent actions, flush) | `durationMs` |
| `appTerminate()` | `app_terminate` (+ flush) | — |
| `backNav()` | `back_nav` | — |
| `deepLink(_:ok:)` | `deep_link` | `url`, `ok` (default `true`) |
| `pushOpen(_:)` | `push_open` | custom (e.g. `campaign`) |
| `otp(_:props:)` | `otp_{start\|fail\|success}` | custom |
| `biometric(_:props:)` | `biometric_{start\|fail\|success}` | custom |
| `payment(_:props:)` | `payment_{start\|fail\|complete}` | `method` |
| `flow(_:_:props:)` | `flow_{start\|complete\|abandon}` | `flow` + custom |
| `permissionDenied(_:)` | `permission_denied` | `permission` |
| `error(_:)` | `error` | `message` |
| `track(_:props:)` | `track` (+ event triggers/goals) | `name` + custom |
| `identify(_:)` | `identify` (persists userId) | — |
| `flush()` | forces a network flush | — |
| `openFaq()` / `openChat()` / `openWhatsApp()` | channel launchers | — |

## Wire protocol & conformance

Normatively defined by `docs/mobile-wire-protocol.md`. `Tests/TrackiSDKTests/ConformanceTests.swift`
loads `sdks/conformance/journey-batch.json` and `channel-requests.json` (relative
to `#filePath`), runs the scripted journey with an injected clock (+1000ms before
each step) and a per-prefix id factory (`anon_1`, `sess_1`), and asserts the
produced batch and channel bodies equal the fixtures as `NSDictionary`.

Run: `swift test`.

## Rendering

Implement `Renderer.show(_ intent: RenderIntent)`; switch on the enum:

- `.action(ActionIntent)` — popup/banner/tooltip/tour/drawer with locale-resolved
  `content`, optional tour `steps`, `activateCta()`, `dismiss()`.
- `.assist(AssistIntent)` — server-driven Live Assist: `title`/`body`/`ctaLabel`,
  `helpful()`/`unhelpful()`/`escalate()`.
- `.faq(FaqIntent)` — pre-fetched `articles` + `search(_:)`.
- `.chat(ChatIntent)` — `send(_:)` returning `(reply, escalate)`, keeping the
  conversation id across turns.

To honour the "a failed render is **not** an impression" rule, conform your
renderer to `ThrowingRenderer` and `throw` from `tryShow(_:)` when a render can't
be presented — the engine then skips the impression, cap bump and goal arm.
