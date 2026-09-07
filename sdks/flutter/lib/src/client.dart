import 'dart:async';

import 'actions.dart';
import 'assist.dart';
import 'cta.dart';
import 'identity.dart';
import 'queue.dart';
import 'transport.dart';
import 'types.dart';

/// "Checkout Screen" → "/Checkout-Screen"-style path key (case preserved).
String screenPath(String name) {
  final cleaned = name.trim().replaceAll(RegExp(r'\s+'), '-');
  return cleaned.startsWith('/') ? cleaned : '/$cleaned';
}

/// Adapts [Identity] to the minimal surface the CTA router needs.
class _IdentityView implements IdentityView {
  final Identity _id;
  _IdentityView(this._id);
  @override
  String getAnonId() => _id.getAnonId();
  @override
  String currentSession() => _id.currentSession();
  @override
  String? getUserId() => _id.getUserId();
}

/// The Tracki mobile client. Hydrates identity from storage, then exposes a
/// fully synchronous tracking API (flushes are async + fail-silent). Emits the
/// cold app_foreground itself — one fewer thing for the host app to remember,
/// and the signal app_restart_loop detection needs.
class TrackiClient {
  final Clock _now;
  final Identity _identity;
  final EventQueue _queue;
  final CtaRouter _cta;
  final ActionEngine _engine;

  String _currentPath = '/';
  String _previousPath = '';
  late int _screenEnteredAt;

  /// Resolves when the action manifest finished loading (tests/bench).
  final Future<void> ready;

  TrackiClient._({
    required Clock now,
    required Identity identity,
    required EventQueue queue,
    required CtaRouter cta,
    required ActionEngine engine,
    required this.ready,
  })  : _now = now,
        _identity = identity,
        _queue = queue,
        _cta = cta,
        _engine = engine {
    _screenEnteredAt = now();
  }

  void _emit(String type, [Map<String, Object?>? props]) {
    _queue.enqueue(EventInput(
      type: type,
      ts: _now(),
      path: _currentPath,
      referrer: _previousPath.isEmpty ? null : _previousPath,
      props: props,
    ));
  }

  /// Screen tracking: emits screen_leave (with duration) + screen_view.
  void screen(String name, [Map<String, Object?>? props]) {
    final next = screenPath(name);
    if (_currentPath != '/') {
      final d = _now() - _screenEnteredAt;
      _emit('screen_leave', {'durationMs': d < 0 ? 0 : d});
    }
    _previousPath = _currentPath == '/' ? '' : _currentPath;
    _currentPath = next;
    _screenEnteredAt = _now();
    _emit('screen_view', props);
    _engine.onScreen();
  }

  /// App lifecycle. The SDK already emitted the initial cold foreground.
  void appForeground([String launch = 'warm']) {
    _emit('app_foreground', {'launch': launch});
  }

  void appBackground() {
    final d = _now() - _screenEnteredAt;
    _emit('app_background', {'durationMs': d < 0 ? 0 : d});
    _engine.onBackground();
    _queue.flush();
  }

  void appTerminate() {
    _emit('app_terminate');
    _queue.flush();
  }

  /// Navigation + entry points.
  void backNav() => _emit('back_nav');

  void deepLink(String url, [bool ok = true]) {
    _emit('deep_link', {'url': url, 'ok': ok});
  }

  void pushOpen([Map<String, Object?>? props]) => _emit('push_open', props);

  /// Auth + payment funnels.
  void otp(String phase, [Map<String, Object?>? props]) => _emit('otp_$phase', props);

  void biometric(String phase, [Map<String, Object?>? props]) =>
      _emit('biometric_$phase', props);

  void payment(String phase, [Map<String, Object?>? props]) =>
      _emit('payment_$phase', props);

  /// Named flows: checkout | registration | loan | kyc | onboarding | custom.
  void flow(String phase, String flow, [Map<String, Object?>? props]) {
    final merged = <String, Object?>{...?props, 'flow': flow};
    _emit('flow_$phase', merged);
  }

  void permissionDenied(String permission) =>
      _emit('permission_denied', {'permission': permission});

  void error(String message) => _emit('error', {'message': message});

  /// Custom events — also evaluates action `event` triggers + goals.
  void track(String name, [Map<String, Object?>? props]) {
    final merged = <String, Object?>{...?props, 'name': name};
    _emit('track', merged);
    _engine.onTrack(name);
  }

  /// Identify the signed-in user (bridges anonymous → known).
  void identify(String userId) {
    _identity.setUserId(userId);
    _emit('identify');
  }

  /// Channel launchers (FAQ / Agent chat / WhatsApp) — usable directly.
  void openFaq() => _cta.openFaq();
  void openChat() => _cta.openChat();
  void openWhatsApp() => _cta.openWhatsApp();

  /// Force a network flush (returns when the batch settled).
  Future<void> flush() => _queue.flush();

  /// Introspection (tests/bench).
  String anonId() => _identity.getAnonId();
  String sessionId() => _identity.currentSession();
  String path() => _currentPath;
}

/// Construct and initialize a [TrackiClient]: hydrate identity, wire the queue,
/// CTA router, assist handler and action engine, then emit the cold foreground.
Future<TrackiClient> createTracki(TrackiConfig config) async {
  final now = config.clock ?? () => DateTime.now().millisecondsSinceEpoch;
  final transport = config.transport ?? httpTransport();
  final newId = config.idFactory ?? defaultIdFactory;
  String localeFn() => config.locale ?? 'ar';

  // The device block is sent verbatim (matching the TS reference); the host
  // app sets `sdk: "flutter"` when it wants the SDK tag on the wire.
  final device = config.device;

  final identity = Identity(config.storage, now, newId);
  await identity.hydrate();

  // currentPath starts at "/"; captured lazily by closures below.
  late TrackiClient client;

  final queue = EventQueue(
    config.key,
    '${config.endpoint}/v1/events',
    identity,
    device,
    transport,
    now,
  );

  final cta = CtaRouter(
    key: config.key,
    endpoint: config.endpoint,
    locale: localeFn,
    platform: () => config.device.platform,
    currentPath: () => client.path(),
    queue: queue,
    transport: transport,
    renderer: config.renderer,
    openUrl: config.openUrl,
    identity: _IdentityView(identity),
    now: now,
  );

  final assist = AssistHandler(
    locale: localeFn,
    currentPath: () => client.path(),
    queue: queue,
    renderer: config.renderer,
    cta: cta,
    now: now,
  );
  queue.setResponseHandler(assist.onResponse);

  final engine = ActionEngine(
    key: config.key,
    endpoint: config.endpoint,
    locale: localeFn,
    currentPath: () => client.path(),
    anonId: () => identity.getAnonId(),
    queue: queue,
    transport: transport,
    storage: config.storage,
    renderer: config.renderer,
    cta: cta,
    now: now,
  );
  final ready = engine.start();

  client = TrackiClient._(
    now: now,
    identity: identity,
    queue: queue,
    cta: cta,
    engine: engine,
    ready: ready,
  );

  // The launch itself: a cold start (drives app_restart_loop detection).
  client._emit('app_foreground', {'launch': 'cold'});

  return client;
}
