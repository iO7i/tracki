# @tracki/react-native

The Tracki behavioral-intelligence SDK for React Native — a thin adapter over
the verified [`@tracki/mobile-core`](../mobile-core) protocol engine
(see `docs/mobile-wire-protocol.md`).

**Status: verified** — the core engine is unit-tested, conformance-tested
against `sdks/conformance/`, and driven against the real ingest stack by
`apps/ingest/bench/mobile-check.mjs`. UI is headless: your app draws intents
with its own design system (and stays fully RTL-correct).

## Quickstart

```tsx
import {
  TrackiProvider, TrackiSurface, nativeBindings, useTracki,
} from "@tracki/react-native";

export default function App() {
  return (
    <TrackiProvider
      options={{ key: "pk_…", endpoint: "https://ingest.example", appVersion: "2.1.0", locale: "ar" }}
      bindings={nativeBindings()}
    >
      <Screens />
      {/* Draw Tracki intents (in-app modal / banner / tour / Live Assist drawer / FAQ / chat) */}
      <TrackiSurface render={(intent, clear) => <MyTrackiUi intent={intent} onClose={clear} />} />
    </TrackiProvider>
  );
}

function CheckoutScreen() {
  const tracki = useTracki();
  useEffect(() => tracki?.screen("Checkout"), [tracki]);
  // tracki.otp("fail"), tracki.payment("fail", { method: "mada" }),
  // tracki.flow("abandon", "checkout"), tracki.track("purchase"), tracki.identify(userId)…
}
```

Automatically wired: AsyncStorage identity (30-min session rotation), AppState
foreground/background (warm launches, exit-intent actions, background flush),
hardware-back tracking, deep-link tracking, `Linking.openURL` for WhatsApp
handoffs and URL CTAs. The cold `app_foreground` is emitted by the SDK itself.

**Deep-link failures:** the auto-wiring only sees links that successfully
opened the app (`ok: true`). When your navigation fails to resolve a link,
report it yourself — `tracki.deepLink(url, false)` — that's the signal behind
the `deep_link_failure` struggle and its Live Assist.

Peer deps: `react`, `react-native`, `@react-native-async-storage/async-storage`.
