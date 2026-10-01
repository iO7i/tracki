# @io7i/tracki-react-native

Headless React Native and Expo integration for Tracki and CCO. Emits bounded
application events and diagnostic codes. Does not record screens, view trees,
screenshots, touch coordinates, keystrokes, field values, error messages,
raw stacks, request bodies, or arbitrary header contents. Only allowlisted opaque correlation IDs and a fixed rejection category are used.

## Installation

Install matching `@io7i/tracki-react-native` and `@io7i/tracki-mobile-core` 0.2.0 packages
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
import { observeJavaScriptErrors } from "@io7i/tracki-react-native";

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

## Private reproducible distribution

Both packages are private GitHub Packages associated with `iO7i/tracki`.
Configure `@io7i:registry=https://npm.pkg.github.com` and provide a repository-authorized `read:packages` credential through an environment-backed npmrc. Never commit a credential. Install exact versions and retain the lockfile. No local `file:` dependency is required.

## Reliability and interpretation

`collectionBudget` bounds events (maximum 500), queue bytes (512 KiB), event TTL (23 hours), batch events (50), batch bytes (96 KiB), routine-success sampling, and unusual latency. Failures/slow requests are unsampled; capacity eviction prefers routine successes. `queueHealth()` exposes observed/sample/loss/receipt/storage counters. A report is evidence of collection health, not an assertion that no incident occurred.

`createCcoNativeBridge` submits a health-only report every five minutes while its JS runtime is active, bounded to 1–15 minutes through `healthIntervalMs`; explicit `reportHealth()` supports host lifecycle boundaries. It never fabricates an event. Logout clears tenant counters, reporter identity and grants. Delivery failures use fixed categories; permanent rejected batches are not retried forever.

`tracedFetch` captures status/timing and allowlisted opaque request/operation/job IDs only. HTTP 2xx means client-observed acceptance, not authoritative business completion. Backend/job/readback outcomes must come from the authenticated server evidence path.

Global JS errors retain the host handler. Numeric frames in recognized bundle files may produce an opaque fingerprint; raw messages, function names, paths and stacks are never emitted. `observeUnhandledRejections` uses an explicitly supported host subscription seam and never monkey-patches Promise. Native crash observation correlates the host's existing provider notification; it cannot guarantee delivery during a terminal crash.

Sampled-out/invalid-observation counter writes coalesce within one second and are forced by `flush()` and explicit health reports. A terminal process kill can lose that last in-memory counter interval; it is not complete observation. Queued event persistence remains immediate. Binary/runtime/update changes rotate the current session while retaining historical batch identities and grants.
