# Native Tracki/CCO store-submission worksheet

Updated 2 October 2026. Scope: `@io7i/tracki-mobile-core` and
`@io7i/tracki-react-native` 0.2.x, with authenticated native CCO forwarding. This is a preparation worksheet, not a submitted store
form, store approval, legal opinion, or proof of physical-device behavior.

## What this implementation does

Both diagnostics and activity start disabled. A host backend must verify the
current bearer, merchant/store access, and capture decision before authorizing
collection. A backend decision is an authorization control; it is not evidence
that the app has satisfied any required user disclosure/consent flow.

The shared client/collector allowlist limits events to fixed codes, bounded
numbers/booleans, authored object IDs, sanitized route templates and trace
identifiers. It excludes screen recording, screenshots, native view trees,
touch coordinates, keystrokes, input values, error messages/stacks, request or
response bodies, authorization and arbitrary header contents. Only validated opaque request/operation/job IDs and fixed rejection categories are read. It cannot produce native
visual replay. Inspect `packages/shared/src/mobile-diagnostics.ts` when
changing this inventory; names accepted by that schema are not automatically
collected by every host.

`observeJavaScriptErrors` reports `JS_ERROR`/`JS_FATAL`, preserving the host
handler. `observeNativeCrashSignals` accepts a no-payload signal from a
host-owned crash provider and reports `NATIVE_CRASH`. It does not install a
native crash reporter, collect a crash dump, symbolicate it, or guarantee
delivery when the OS terminates a process.

## Additional bounded diagnostics in this wave

Health reports contain queue depth/bytes/age, fixed rejection categories,
receipt/storage/expiry/capacity/sampling counters, reporter revision and time.
They are authenticated and account/scope linked even when there are no events.
They contain no user input. Counters coalesce for up to one second; process
termination may lose that interval. A missing heartbeat is incomplete evidence.

Optional normalized JavaScript fingerprints hash recognized bundle numeric
frame locations only; message, function name, path and raw stack are excluded.
Opaque operation/job/request IDs join authorized backend evidence without
copying business inputs. These fields belong in the shipped diagnostic inventory.
They do not add native recording or guarantee terminal crash delivery.

## Data map: declare the shipped app, not this worksheet

Use actual release configuration, enabled host instrumentation, server logs,
and dependency behavior to complete the forms. Server-resolved identity joins
make this data account-linked even when the mobile identifiers are random.
Pseudonymous does not mean anonymous.

| Data actually delivered | Condition | Apple draft classification | Google Play draft classification |
| --- | --- | --- | --- |
| Random `anonId`/`sessionId`, authenticated account/store binding, optional host user ID | Accepted enabled diagnostic/activity batches; account binding occurs on the backend | Identifiers → User ID; assess Device ID if a persistent app-install identifier identifies a device. Linked to user | Personal info → User IDs; assess Device or other IDs for persistent app/install identifiers |
| Request status, duration, fixed network/error codes, event time, trace/span IDs, sanitized route template | Diagnostics enabled and host uses the observer/traced-fetch seams | Diagnostics → Performance Data / Other Diagnostic Data; linked to user | App info and performance → Diagnostics / Other app performance data |
| `JS_ERROR`, `JS_FATAL`, or host-supplied `NATIVE_CRASH` signal | Corresponding observer enabled and signal occurs | Assess Crash Data for fatal/crash-related records; other error codes may be Other Diagnostic Data | Assess Crash logs for crash-related records; ordinary technical errors may be Diagnostics |
| Platform, OS/app version; build/runtime/update identity | Included by configured native bindings/host | Diagnostic context; add identifier classification only if actually used to identify a device | Diagnostic context; Device or other IDs only where the collected value meets that definition |
| Static screen/lifecycle/back/deep-link events; fixed flow/action/help/permission/payment event enums, authored action/article IDs, variant, bounded counts | **Only if activity is enabled and those events are instrumented** | Usage Data → Product Interaction / Other Usage Data; linked to user | App activity → App interactions / Other actions; linked to identifiers |

Purposes must follow use: Apple App Functionality covers support/reliability;
Analytics covers behavior analysis. Google Analytics explicitly includes app
health and debugging; add App functionality where data supports an actual
in-app function. Account management applies only to genuine account-management
use, not as a blanket label for every account-linked diagnostic. If payment or
purchase events expose a transaction/purchase fact, assess Purchase History
even without an amount; do not automatically label all enabled activity as
only generic interactions.

These are candidate mappings, not an instruction to tick every category.
Do not declare a capture module that remains disabled, but do include data
collected by other enabled SDKs/features. No raw financial/input data is added
to this diagnostic schema. The host's normal authenticated business requests
may still collect names, payment details, messages, searches or other inputs;
their existing declarations must remain accurate. Hosting/access logs, IP
handling, crash providers, Expo Updates, authentication and support services
need their own inventory.

Sources: [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
and [Google Play Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en).

## Conditional form answers

- **Collection:** answer Yes for relevant types once sent off the device and
  retained/processed by the app backend or collector. Optional, pseudonymous,
  or first-party handling does not itself remove disclosure.
- **Linked to user (Apple):** Yes for diagnostic/activity records joined to
  merchant/account/store identity. Do not describe this pipeline as anonymous.
- **Tracking (Apple):** this integration has no advertising identifier,
  cross-company advertising join or data-broker purpose. For this module's
  first-party diagnostic use, the draft answer is No. Audit the whole app and
  all vendors before answering. ATT is a separate test; do not set
  `NSPrivacyTracking: true` merely because a diagnostic identifier exists.
- **Sharing (Google):** first-party Vertex handling is distinct from third-party
  sharing. A processor acting solely on the developer's instructions may meet
  the service-provider exception. Confirm the publisher/entity relationship
  and vendor contracts; collection must still be declared.
- **Optional/required:** mark collection Optional only if the shipped user can
  opt in/out and still use the app without that collection. A developer-only
  server toggle does not establish a user choice. Otherwise assess Required
  according to actual app behavior and policy.
- **Encryption/deletion:** claim encryption in transit only after checking all
  collected app/SDK data paths. Confirm retention, deletion requests, account
  deletion and vendor propagation operationally. Local queue reset does not
  delete already-uploaded evidence.

Apple's ATT definition concerns cross-company ad targeting/measurement and
data brokers; first-party support correlation alone does not meet it. This
does not exempt other privacy requirements. [Apple User Privacy and Data Use](https://developer.apple.com/app-store/user-privacy-and-data-use/)

## Disclosure and consent before enablement

Apple §2.5.14 requires explicit consent and a clear visual/audible indication
when recording/logging user activity, including inputs. If enabling activity
capture, resolve that experience before release; removing video does not
prove exemption. §5.1.1 also addresses usage-data permission, withdrawal and
retention/deletion disclosures. Do not claim that a server policy alone
satisfies these rules. [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

Google requires prominent normal-use in-app disclosure and affirmative consent
before unexpected personal/sensitive collection. Describe data, purpose and
sharing; a policy link hidden in Settings is insufficient where the rule
applies. The policy treats screen recordings as sensitive data, although this
integration produces none. [Google Play User Data](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en-GB)

The current module needs no camera, microphone, screen-projection or
AccessibilityService access. Fixed `permission_denied` or biometric event
codes do not grant permissions or collect camera/audio/biometric data. A later
recorder, ad/attribution SDK or crash provider changes this assessment and
requires a new data inventory and policy review.

## App Privacy answers and privacy manifests are different artifacts

App Store Connect App Privacy describes the whole app's off-device collection,
purposes, identity linkage and tracking. `PrivacyInfo.xcprivacy` is a resource
inside the iOS app/SDK describing collected-data practices and required-reason
API usage. Completing one does not complete the other.

The Tracki event core is pure JavaScript with injected storage/transport and
has no direct required-reason native API calls of its own. That is **not** an
empty-manifest determination for an Expo/RN app: inspect native storage,
React Native/Hermes, Expo SecureStore/Crypto, Updates and every other dependency
in the exact generated release archive. Supply appropriate data declarations
for the Tracki integration, and do not manufacture API reasons for APIs it
does not use. Listed Apple SDKs need manifests; listed binary dependencies
also need signatures. [Apple SDK Requirements](https://developer.apple.com/support/third-party-SDK-requirements/),
[Apple Privacy Manifest Files](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)

Local dependency inspection: AsyncStorage **3.1.1** supplies
`apple/PrivacyInfo.xcprivacy` with an empty `NSPrivacyCollectedDataTypes` array
and `NSPrivacyAccessedAPICategoryFileTimestamp` reason **C617.1**. Its
`AsyncStorage.podspec` includes that file in `AsyncStorage_resources`.
This proves the installed source resource, not successful inclusion or
aggregation in an iOS binary. The empty collection array describes that
storage dependency, not data uploaded by Tracki or the host app.

Expo supports `expo.ios.privacyManifests` in app configuration. Check dependency
manifests and their inclusion/aggregation rather than copying a universal
UserDefaults reason. Build with SDK-compatible dependency versions installed
through `npx expo install`. [Expo Privacy Manifests](https://docs.expo.dev/guides/apple-privacy/)

Grants belong in protected SecureStore storage, not AsyncStorage. Review the
actual SecureStore config and Android backup exclusions. iOS Keychain values
may survive uninstall/reinstall, so neither uninstall nor a local reset is
proof of server deletion or grant revocation. Crypto supplies randomness for
trace identifiers; its installed native archive still belongs in the dependency
review. [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/),
[Expo Crypto](https://docs.expo.dev/versions/latest/sdk/crypto/)

## Candidate-specific acceptance still pending

Before submitting a participating app, record its binary/build/runtime/update
identity and verify physical iOS/Android behavior: policy denied/allowed/
revoked, current bearer/store scope, offline retry, expiry/re-authentication,
logout/account switch, lifecycle/deep links, handler coexistence, payload
redaction, and staged/production isolation. Review the actual iOS manifest
report and Android permissions/backup config. Exercise any host assistance UI
in its supported locales/directions/accessibility states.

Package source checks and a web reference are not native device acceptance.
No native recorder or production rollout is established by this worksheet.
EAS uploads do not themselves certify store approval or complete metadata;
iOS TestFlight upload does not publish the app. [Expo Submission Overview](https://docs.expo.dev/deploy/submit-to-app-stores/)

For review notes, accurately describe an event-only diagnostic integration,
its actual policy controls, absence of visual/input recording, and a working
review account. Link the app's real privacy policy and data-choice/deletion
process; do not paste a generic approval claim.
