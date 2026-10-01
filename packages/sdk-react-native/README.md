# @tracki/react-native

Headless React Native and Expo integration for Tracki and CCO. Emits bounded
application events and diagnostic codes. Does not record screens, view trees,
screenshots, touch coordinates, keystrokes, field values, error messages,
stacks, request bodies, or header contents.

## Installation

Install matching `@tracki/react-native` and `@tracki/mobile-core` 0.1.0 packages
and the host peer dependencies. Expo apps should install AsyncStorage through
`npx expo install @react-native-async-storage/async-storage` so its native
version matches Expo. React/RN remain supplied by the existing app.

Both packages export compiled ESM JavaScript and declarations from `dist`.
Build mobile-core before react-native. The adapter keeps React, React Native
and AsyncStorage external; the core bundles its pure diagnostic sanitizer.
Package build/prepack scripts do not publish or deploy anything. The declaration
build excludes native shims and checks installed real peer types.

## Capture policy and identity

Activity and diagnostics both start disabled. The authenticated backend
approves policy and merchant/store identity through `createCcoNativeBridge`.
A public project key is not authenticated merchant identity. Store grants in
protected storage; never embed collector signing secrets in the app. Before
logout/store switching, await bridge reset and dispose the old client.

Instrument app-owned static screen names and fixed event/error codes. Never
include search queries, user text, emails, merchant names or full URLs. Business
inputs stay in the existing authenticated business requests.

## Optional diagnostics

```ts
import { observeJavaScriptErrors } from "@tracki/react-native";

const stopObserving = observeJavaScriptErrors(client);
// Later, before disposing the client:
stopObserving();
```

The observer sends only `JS_ERROR` or `JS_FATAL` and preserves the host's
original error handler. `observeNativeCrashSignals` accepts a host-owned crash
provider's no-payload notification; it reports only `NATIVE_CRASH`. It does not
install a native recorder, upload crash files, or guarantee terminal delivery.

TrackiProvider/TrackiSurface support host-rendered assistance intents. Native
UI, routing, accessibility and Arabic RTL remain the host's responsibility.

## Expo and acceptance

The event adapter adds no native module beyond AsyncStorage. Exact Expo SDK,
runtime, EAS build/update, auth, backend policy and physical-device behavior
still require a representative app check. A native dependency change requires
a new binary. A JS update must match the installed runtime. No native visual
replay is produced.

See [native CCO integration](../../docs/native-cco-integration.md) for executable
host wiring, backend requirements, artifact identity and acceptance boundaries.
