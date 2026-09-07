# tracki-android

Kotlin port of `@tracki/mobile-core` — the headless protocol engine for Tracki's
behavioral-intelligence platform. The core module is **pure Kotlin/JVM** (only
`org.json` + `kotlinx-coroutines-core`) so the conformance suite runs under plain
JUnit; the Android adapter (`Adapter.kt`) holds the SharedPreferences storage and
is the only file that touches `android.*` (a `compileOnly` dependency).

> **Status: source-complete, NOT compile-verified** — this SDK implements
> `docs/mobile-wire-protocol.md` and ships conformance tests against
> `sdks/conformance/`, but no Flutter/Xcode/Gradle toolchain runs in CI yet.
> Treat the TypeScript `@tracki/mobile-core` as the reference until native CI
> lands.

## Quickstart

```kotlin
import app.tracki.sdk.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope

val scope: CoroutineScope = MainScope() // owns async flushes + manifest load

val tracki = createTracki(
    TrackiConfig(
        key = "pk_live_xxx",
        endpoint = "https://ingest.tracki.app",
        device = DeviceInfo(
            platform = "android",
            osVersion = "14",
            appVersion = "2.1.0",
            model = "Pixel 8",
            sdk = "android",
        ),
        storage = SharedPreferencesStorage(context),
        locale = "ar",                                   // Arabic-first; "en" too
        renderer = MyRenderer(),                         // draws native UI
        openUrl = { url -> startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) },
    ),
    scope = scope,
)

// Tab a screen — emits screen_leave (with duration) + screen_view.
tracki.screen("Checkout")
tracki.payment("fail", mapOf("method" to "mada"))
tracki.identify("user_42")
tracki.flush()
```

`createTracki` is a `suspend` function (it hydrates identity from storage); call
it from a coroutine. The SDK emits the cold `app_foreground` itself at
construction (drives the server's `app_restart_loop` detection). Tracking calls
are synchronous and fail-silent; flushes happen on the injected scope and never
throw into the host app. Wire bodies are `Map<String, Any?>` serialized via
`org.json`, so omitted/optional fields are **absent** from the JSON (never null).

## Event API

| Method | Emits | Props |
|---|---|---|
| `screen(name, props?)` | `screen_leave` (prev) + `screen_view` | `durationMs` on leave; custom on view |
| `appForeground(launch?)` | `app_foreground` | `launch` (`"warm"` default; `"cold"` auto at init) |
| `appBackground()` | `app_background` (+ exit-intent actions, flush) | `durationMs` |
| `appTerminate()` | `app_terminate` (+ flush) | — |
| `backNav()` | `back_nav` | — |
| `deepLink(url, ok?)` | `deep_link` | `url`, `ok` (default `true`) |
| `pushOpen(props?)` | `push_open` | custom (e.g. `campaign`) |
| `otp(phase, props?)` | `otp_{start\|fail\|success}` | custom |
| `biometric(phase, props?)` | `biometric_{start\|fail\|success}` | custom |
| `payment(phase, props?)` | `payment_{start\|fail\|complete}` | `method` |
| `flow(phase, flow, props?)` | `flow_{start\|complete\|abandon}` | `flow` + custom |
| `permissionDenied(permission)` | `permission_denied` | `permission` |
| `error(message)` | `error` | `message` |
| `track(name, props?)` | `track` (+ event triggers/goals) | `name` + custom |
| `identify(userId)` | `identify` (persists userId) | — |
| `flush()` | forces a network flush (suspend) | — |
| `openFaq()` / `openChat()` / `openWhatsApp()` | channel launchers | — |

## Wire protocol & conformance

Normatively defined by `docs/mobile-wire-protocol.md`. `src/test/kotlin/app/tracki/sdk/ConformanceTest.kt`
loads `sdks/conformance/journey-batch.json` and `channel-requests.json`, runs the
scripted journey with an injected clock (+1000ms before each step) and a
per-prefix id factory (`anon_1`, `sess_1`), and asserts the produced batch and
channel bodies equal the fixtures as parsed structures.

Run: `./gradlew test`.

## Rendering

Implement `Renderer.show(intent: RenderIntent)` and branch on the sealed type:

- `ActionIntent` — popup/banner/tooltip/tour/drawer with locale-resolved
  `content`, optional tour `steps`, `activateCta()`, `dismiss()`.
- `AssistIntent` — server-driven Live Assist: `title`/`body`/`ctaLabel`,
  `helpful()`/`unhelpful()`/`escalate()`.
- `FaqIntent` — pre-fetched `articles` + `search(query)`.
- `ChatIntent` — `send(message)` returning `ChatReply(reply, escalate)`, keeping
  the conversation id across turns.

A renderer that throws from `show()` is treated as a failed render: no
impression, no cap bump, no goal arm (matching the reference's feature-3 rule).
