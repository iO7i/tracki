# Native CCO integration: event evidence without recording

## Supported scope

This integration connects Expo/React Native activity and diagnostics to CCO
using the app's authenticated backend. It excludes screen recording,
screenshots, view snapshots, touches, pointer trails, raw inputs, request/
response bodies, error text and stack traces. Watchtower can show the accepted
activity/backend timeline; these events cannot reconstruct a native screen or
produce visual replay.

The same installation path supports staging and production. Give each its own
backend origin, storage namespace, Tracki project key and server policy. An
environment label supplied by the app is not a grant to access production.

## Backend integration contract

1. Expose native CCO bootstrap/events/health handlers behind the host app's existing
   native authentication guard.
2. Resolve the authenticated account and active store installation on the
   backend. Never accept identity, policy or collector credentials from an
   arbitrary native request body.
3. Determine the allowed diagnostic/activity policy on the server. A denied
   policy produces no capture, including before bootstrap or after expiry.
4. Mint the bounded native grant using the server-only native signing key.
5. Accept native event batches through the authenticated host backend and
   forward only the approved schema to the collector. Keep existing business
   input handling separate from diagnostic evidence.

The bootstrap/events/health API requires host-specific wiring. Installing the SDK
does not authenticate merchants, deploy a route or enable collection.

### Server package, schema and credentials

Use the matching native-enabled `@vertex-ksa/cco` 0.4.0 release artifact from
`vertex-platform/packages/cco` in the application backend. The Tracki native
SDK is a different package; installing it does not update that server package.
SDK 0.2.1 is privately published; CCO 0.4.0 publication uses its guarded repository workflow. Backend deployment and migrations remain separate reviewed steps. Existing web recording behavior is separate from this native
integration.

Before starting the native-enabled producer, apply its outbox migrations using
the service's migration role. Existing installations with migration 001 applied
need migrations 002 and 003 if neither is applied; fresh installations need 001 followed by
002 and 003 in order. Migration 003 adds `native-health` commands. Migration 002 expands the outbox command-kind constraint to include
`native`. It belongs in each participating service-owned outbox database,
including staging; do not apply it indiscriminately to business databases.

Configure `CCO_ENABLED`, `CCO_COLLECTOR_URL`, `CCO_PRODUCER_KEY`,
`CCO_OUTBOX_DATABASE_URL`, `CCO_ENVIRONMENT` and a distinct server-only
`CCO_NATIVE_SIGNING_KEY` of at least 32 characters. Follow the existing producer
release configuration and durable forwarding setup. Never place signing,
producer or database credentials in an Expo public variable or mobile bundle.
The native collector endpoint is `/internal/cco/native-batches`; deploy its
matching Tracki collector implementation before forwarding native commands.

### Express route wiring

```ts
import express from "express";
import {
  ccoNativeExpressHandler, type CapturePolicy, type RequestLike, type Scope,
} from "@vertex-ksa/cco";

// Host-owned services below already verify native authentication and store access.
const authenticateBearer = async (
  authorization: string, request: RequestLike,
): Promise<Scope | null> => {
  const principal = await appAuth.verifyBearer(authorization);
  if (!principal) return null;
  return appIdentity.verifiedScopeForRequest(principal, request);
};

// Load the recorded backend decision for THIS verified account/store scope.
// Do not read a capture policy from the incoming body or authorize via cookies.
const decision = async (_request: RequestLike, current: Scope): Promise<CapturePolicy> =>
  backendCapturePolicy.forScope(current);

const nativeJson = express.json({ limit: "128kb" });
app.post("/api/cco/native/bootstrap", nativeJson,
  ccoNativeExpressHandler(appKey, "bootstrap", authenticateBearer, decision));
app.post("/api/cco/native/events", nativeJson,
  ccoNativeExpressHandler(appKey, "events", authenticateBearer, decision));
app.post("/api/cco/native/health", nativeJson,
  ccoNativeExpressHandler(appKey, "health", authenticateBearer, decision));
```

The example's auth, identity and policy services are host integration seams,
not new services supplied by this package. Both factory callbacks are required.
The verifier must validate the actual bearer passed to it and enforce current
store access; an existing cookie scope alone is insufficient. Return a denied
`{ diagnostics: false, activity: false }` policy when collection is not allowed.
Failures to resolve authentication/policy must not enable collection.

For Web Request/Response backends, use the exported `ccoNativeWebResponse`
after verifying the request's bearer and resolving the current scope and
server policy. It does not authenticate a caller on its own.

## Host initialization

```ts
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import {
  createCcoNativeBridge,
  createTrackiClient,
  nativeBindings,
  observeJavaScriptErrors,
} from "@io7i/tracki-react-native";

const randomHex = (bytes: number) => Array.from(Crypto.getRandomBytes(bytes),
  (byte) => byte.toString(16).padStart(2, "0")).join("");

const bridge = await createCcoNativeBridge({
  apiOrigin: appBackendOrigin,
  namespace: `${appCode}:${environment}:${activeStoreScope}`,
  getAuthorization: async () => {
    const token = await existingAuth.getAccessToken();
    return token ? `Bearer ${token}` : null;
  },
  grantStorage: {
    // The bridge generates SecureStore-compatible keys and separate grant items.
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value),
    remove: (key) => SecureStore.deleteItemAsync(key),
  },
  createTraceContext: () => ({ traceId: randomHex(16), spanId: randomHex(8) }),
});

const { client, dispose } = await createTrackiClient({
  key: publicTrackiProjectKey,
  endpoint: appBackendOrigin,
  storageNamespace: `${appCode}:${environment}`,
  environment,
  appVersion: nativeMarketingVersion,
  build: { buildId: nativeBuildId, runtimeVersion, updateId },
  transport: bridge.transport,
}, nativeBindings());

await bridge.connect(client);
const stopObserving = observeJavaScriptErrors(client);
client.screen("Home");

// Use for existing calls to this backend; bodies/headers are never recorded.
const response = await bridge.tracedFetch(`${appBackendOrigin}/api/products`);

// Before logout or changing the active store:
await bridge.reset(client);
stopObserving();
dispose();
bridge.dispose();
```

The auth implementation, project configuration and artifact values in this
example are host-owned. Do not log the authorization header or grant. Grant
storage must be protected storage such as SecureStore, not plain AsyncStorage.
The ordinary event queue contains only the bounded schema. Clear it on scope/
policy changes through the bridge/client APIs. Expo apps should install
AsyncStorage, SecureStore and Crypto through `npx expo install` to match their
SDK. The existing backend tracing middleware must propagate W3C context to
join server evidence; supplying the SDK alone cannot create backend traces.

Use `TrackiProvider`/`TrackiSurface` only when also rendering Tracki's authored
assistance intents with the app's design system. Native views, routing,
accessibility and RTL remain owned by the host application.

## Event and artifact identity

Instrument static screen names such as `Checkout`, enum-like action names such
as `signup_completed`, and fixed failure codes. Unknown custom names normalize
to `custom_event`; the current allowlist is the authoritative contract. Never put merchant names,
emails, search queries, user-entered text, IDs or complete URLs into names.
Business inputs stay in the existing authenticated business request. Network
correlation uses a request identifier, without copying body/header contents.
The backend may use those inputs for its ordinary authorized business operation;
this integration does not copy them into Tracki or Watchtower. Even if an
operator needs to investigate an input later, keep that lookup in the existing
authorized backend flow rather than adding raw inputs to diagnostic events.

Provide the marketing version separately from the native build ID. Obtain
native version/build identifiers from the host's existing Expo Application
integration or build configuration. Obtain runtime version and update ID from
the existing Expo Updates integration; leave unavailable values absent. Do
not manufacture an update ID for embedded bundles or Expo Go. These fields
identify the executing binary and JS update; they do not fetch source maps or
symbolicate native crashes.

## Reliability boundaries

The client uses bounded persistent queues and retains original scope/event
identity while retrying. Authenticated CCO requires a current server grant.
Expired/revoked policy, logout and account changes fail closed and clear
affected pending evidence. A mobile OS can suspend or kill a process before
a flush completes. A lifecycle observer is not a background service and
cannot promise final crash delivery.

`observeJavaScriptErrors` is optional and disposable. It sends only `JS_ERROR`
or `JS_FATAL`, forwarding the original error to the existing host handler.
`observeNativeCrashSignals` accepts a no-payload notification from a host-owned
crash provider and emits only `NATIVE_CRASH`. It installs no native recorder,
uploads no crash file and cannot guarantee delivery during termination.

## Package distribution and Expo builds

Install matching exact `@io7i/tracki-mobile-core` and `@io7i/tracki-react-native`
0.2.1 candidates from private GitHub Packages associated with `iO7i/tracki`.
0.2.0 is already published; 0.2.1 adds approved static HR/platform routes and
finite timer validation. Publication and clean-consumer receipts must accompany
the final candidate. Configure `@io7i:registry=https://npm.pkg.github.com`
and provide repository-authorized read access through an environment-backed
npmrc. Keep the lockfile; never commit a credential. No production `file:` or
workspace dependency is required. React/RN/AsyncStorage remain host peers.

The real mobile platform is `iO7i/mobile-app-kernel`, `expo-mobile-apps`.
HR is the representative integration; its owning mobile chat owns app files
and behavior. Use the existing session/company scope contract. A fixture or
unavailable backend provider is not real authenticated integration acceptance.
The declaration build excludes native shims and checks actual installed peer
types. It does not establish compatibility with every Expo SDK/device. The
event adapter needs no custom native module beyond AsyncStorage. A native
dependency change requires a new binary; a JS update must match the installed
runtime. Native visual replay is outside this package's scope.

## Store submission and release acceptance

This implementation avoids visual/input recording. It is not an Apple/Google
approval guarantee. Declare the actual collected diagnostics, usage,
identifiers and purposes accurately in store disclosures and privacy policy.
Adding ad tracking, a recorder or another crash SDK needs its own review.

Before rollout, verify physical iOS and Android development/production builds
against the actual Expo SDK, runtime, auth guard and backend configuration:

- Capture disabled before grant, after expiry and policy revocation.
- Verified merchant/store identity and staging/production separation.
- Offline retry, bounded storage, re-authentication, logout and store switching.
- Initial deep links, lifecycle and navigation instrumentation.
- Fixed error codes with existing host error/crash handling retained.
- Correct build/runtime/update identity and no sensitive payloads.
- Assistance UI, Arabic RTL and accessibility if intents are enabled.

Package builds/typechecks establish source/distribution coherence only. They
do not replace host/device acceptance checks.
