/// tracki_flutter — the Dart port of `@tracki/mobile-core`.
///
/// The public surface mirrors the TypeScript reference: [createTracki] builds a
/// [TrackiClient] from a [TrackiConfig]; rendering is delegated through the
/// [Renderer] interface via typed [RenderIntent]s. The core is pure Dart so the
/// conformance suite runs under plain `dart test`. The optional adapter in
/// `src/adapter.dart` ([MemoryStorage], [FunctionStorage]) bridges to a host's
/// SharedPreferences without adding a Flutter dependency to the core.
library tracki_flutter;

export 'src/types.dart';
export 'src/identity.dart' show Identity, defaultIdFactory, sessionTimeoutMs;
export 'src/queue.dart' show EventQueue, flushSize, flushIntervalMs;
export 'src/cta.dart' show CtaRouter, CtaKind, ctaKind, IdentityView;
export 'src/actions.dart' show ActionEngine, pickVariant;
export 'src/assist.dart' show AssistHandler;
export 'src/transport.dart' show HttpTransport, httpTransport;
export 'src/client.dart' show TrackiClient, createTracki, screenPath;
export 'src/adapter.dart' show MemoryStorage, FunctionStorage;
