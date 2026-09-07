# tracki_flutter

Dart port of `@tracki/mobile-core` — the headless protocol engine for Tracki's
behavioral-intelligence platform. Pure-Dart core (no Flutter dependency), so the
conformance suite runs under plain `dart test`.

> **Status: source-complete, NOT compile-verified** — this SDK implements
> `docs/mobile-wire-protocol.md` and ships conformance tests against
> `sdks/conformance/`, but no Flutter/Xcode/Gradle toolchain runs in CI yet.
> Treat the TypeScript `@tracki/mobile-core` as the reference until native CI
> lands.

## Quickstart

```dart
import 'package:tracki_flutter/tracki_flutter.dart';

final tracki = await createTracki(TrackiConfig(
  key: 'pk_live_xxx',
  endpoint: 'https://ingest.tracki.app',
  locale: 'ar', // Arabic-first; 'en' also supported
  device: const DeviceInfo(
    platform: 'ios',
    osVersion: '17.4',
    appVersion: '2.1.0',
    model: 'iPhone15,2',
    sdk: 'flutter',
  ),
  // Bridge to SharedPreferences without forcing a Flutter dep on the core:
  storage: FunctionStorage(
    getter: (k) async => prefs.getString(k),
    setter: (k, v) async => prefs.setString(k, v),
  ),
  openUrl: (url) => launchUrl(Uri.parse(url)), // url_launcher in the host app
  renderer: MyRenderer(), // draws popups/assist/faq/chat natively
));

// Tab a screen — emits screen_leave (with duration) + screen_view.
tracki.screen('Checkout');
tracki.payment('fail', {'method': 'mada'});
tracki.identify('user_42');
await tracki.flush();
```

The SDK emits the cold `app_foreground` itself at construction (drives the
server's `app_restart_loop` detection); the host app never has to remember it.
All tracking calls are synchronous and fail-silent — network flushes happen in
the background and never throw into the host app.

## Event API

| Method | Emits | Props |
|---|---|---|
| `screen(name, [props])` | `screen_leave` (prev) + `screen_view` | `durationMs` on leave; custom on view |
| `appForeground([launch])` | `app_foreground` | `launch` (`"warm"` default; `"cold"` auto at init) |
| `appBackground()` | `app_background` (+ exit-intent actions, flush) | `durationMs` |
| `appTerminate()` | `app_terminate` (+ flush) | — |
| `backNav()` | `back_nav` | — |
| `deepLink(url, [ok])` | `deep_link` | `url`, `ok` (default `true`) |
| `pushOpen([props])` | `push_open` | custom (e.g. `campaign`) |
| `otp(phase, [props])` | `otp_{start\|fail\|success}` | custom |
| `biometric(phase, [props])` | `biometric_{start\|fail\|success}` | custom |
| `payment(phase, [props])` | `payment_{start\|fail\|complete}` | `method` |
| `flow(phase, flow, [props])` | `flow_{start\|complete\|abandon}` | `flow` + custom |
| `permissionDenied(permission)` | `permission_denied` | `permission` |
| `error(message)` | `error` | `message` |
| `track(name, [props])` | `track` (+ event triggers/goals) | `name` + custom |
| `identify(userId)` | `identify` (persists userId) | — |
| `flush()` | forces a network flush | — |
| `openFaq()` / `openChat()` / `openWhatsApp()` | channel launchers | — |

## Wire protocol & conformance

This SDK is normatively defined by `docs/mobile-wire-protocol.md`. `test/conformance_test.dart`
loads `sdks/conformance/journey-batch.json` and `channel-requests.json`, runs the
scripted journey with an injected clock (+1000ms before each step) and a
per-prefix id factory (`anon_1`, `sess_1`), and asserts the produced batch and
channel request bodies equal the fixtures as parsed JSON.

Run: `dart pub get && dart test`.

## Rendering

Implement `Renderer.show(RenderIntent)`. The intent is one of:

- `ActionIntent` — campaign popup/banner/tooltip/tour/drawer with locale-resolved
  `content`, optional tour `steps`, `activateCta()`, `dismiss()`.
- `AssistIntent` — server-driven Live Assist: `title`/`body`/`ctaLabel`,
  `helpful()`/`unhelpful()`/`escalate()`.
- `FaqIntent` — pre-fetched `articles` + `search(query)`.
- `ChatIntent` — `send(message)` returning `{reply, escalate}`, keeping the
  conversation id across turns.
