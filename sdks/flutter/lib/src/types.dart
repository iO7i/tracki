/// tracki_flutter — the Dart port of `@tracki/mobile-core`, the headless
/// protocol engine every Tracki mobile SDK wraps (React Native directly;
/// Flutter/iOS/Android re-implement the same wire protocol — see
/// docs/mobile-wire-protocol.md). Zero UI, zero platform APIs: storage /
/// transport / clock are injected, rendering is delegated to a platform
/// renderer through typed intents.
///
/// The core library is dependency-free pure Dart so the conformance test runs
/// with plain `dart test`; a small Flutter adapter lives in
/// `lib/src/flutter_adapter.dart`.
library;

// ── Wire mirrors (type-compatible with the TS reference's types.ts) ──────────

/// Mobile platform identifier sent in every batch's device block.
typedef MobilePlatform = String; // "ios" | "android"

/// Device block of the batch envelope. Omitted fields are ABSENT from JSON.
class DeviceInfo {
  /// "ios" | "android" (REQUIRED for mobile).
  final String platform;

  /// OS version string (≤32 chars).
  final String? osVersion;

  /// App version string (≤32 chars) — drives revenue-by-app-version.
  final String? appVersion;

  /// Device model (≤64 chars).
  final String? model;

  /// "react-native" | "flutter" | "ios" | "android".
  final String? sdk;

  const DeviceInfo({
    required this.platform,
    this.osVersion,
    this.appVersion,
    this.model,
    this.sdk,
  });

  /// JSON with omitted optionals absent (never null), mirroring the wire spec.
  Map<String, Object?> toJson() {
    final m = <String, Object?>{'platform': platform};
    if (osVersion != null) m['osVersion'] = osVersion;
    if (appVersion != null) m['appVersion'] = appVersion;
    if (model != null) m['model'] = model;
    if (sdk != null) m['sdk'] = sdk;
    return m;
  }

  factory DeviceInfo.fromJson(Map<String, Object?> j) => DeviceInfo(
        platform: j['platform'] as String,
        osVersion: j['osVersion'] as String?,
        appVersion: j['appVersion'] as String?,
        model: j['model'] as String?,
        sdk: j['sdk'] as String?,
      );
}

/// A single queued event. `path`/`referrer`/`url`/`props` are omitted from the
/// serialized JSON when null (the wire protocol forbids explicit nulls).
class EventInput {
  final String type;
  final int ts;
  final String? path;
  final String? url;
  final String? referrer;
  final Map<String, Object?>? props;

  const EventInput({
    required this.type,
    required this.ts,
    this.path,
    this.url,
    this.referrer,
    this.props,
  });

  Map<String, Object?> toJson() {
    final m = <String, Object?>{'type': type, 'ts': ts};
    if (path != null) m['path'] = path;
    if (url != null) m['url'] = url;
    if (referrer != null) m['referrer'] = referrer;
    if (props != null) m['props'] = props;
    return m;
  }
}

/// The `/v1/events` batch envelope. `userId` is omitted when anonymous.
class Batch {
  final String key;
  final String anonId;
  final String? userId;
  final String sessionId;
  final int sentAt;
  final DeviceInfo device;
  final List<EventInput> events;

  const Batch({
    required this.key,
    required this.anonId,
    this.userId,
    required this.sessionId,
    required this.sentAt,
    required this.device,
    required this.events,
  });

  Map<String, Object?> toJson() {
    final m = <String, Object?>{
      'key': key,
      'anonId': anonId,
    };
    if (userId != null) m['userId'] = userId;
    m['sessionId'] = sessionId;
    m['sentAt'] = sentAt;
    m['device'] = device.toJson();
    m['events'] = events.map((e) => e.toJson()).toList();
    return m;
  }
}

// ── Injected platform adapters ───────────────────────────────────────────────

/// Async key-value persistence (AsyncStorage / SharedPreferences / UserDefaults).
abstract class KeyValueStorage {
  Future<String?> get(String key);
  Future<void> set(String key, String value);
}

/// HTTP transport; the default implementation uses `dart:io` HttpClient.
abstract class Transport {
  Future<Object?> post(String url, Object? body);
  Future<Object?> get(String url);
}

/// Injectable clock for deterministic tests — returns ms epoch.
typedef Clock = int Function();

/// Id factory keyed by prefix ("anon" / "sess"). Test seam.
typedef IdFactory = String Function(String prefix);

// ── Render intents (SDK → app UI) ────────────────────────────────────────────

/// Locale-resolved content for an action/assist surface.
class LocalizedContent {
  final String title;
  final String body;
  final CtaContent? cta;
  const LocalizedContent({required this.title, required this.body, this.cta});
}

/// A channel CTA. `kind` ∈ url|faq|chat|whatsapp; legacy `faq:true` ⇒ faq.
class CtaContent {
  final String label;
  final String? kind;
  final String? url;
  final bool? faq;
  const CtaContent({required this.label, this.kind, this.url, this.faq});
}

/// One guided-tour step, locale-resolved.
class TourStepContent {
  final String title;
  final String body;
  final String? anchor;
  const TourStepContent({required this.title, required this.body, this.anchor});
}

/// Base class for everything handed to the platform [Renderer].
abstract class RenderIntent {
  const RenderIntent();
}

/// A campaign action ready to render (popup/banner/tooltip/tour/drawer).
class ActionIntent extends RenderIntent {
  final String actionId;

  /// popup ⇒ in-app modal; banner; tooltip; tour (steps); drawer (help sheet).
  final String type;
  final String variant; // "A" | "B"

  /// Content resolved for the configured locale.
  final LocalizedContent content;

  /// Guided-tour steps (type "tour"), locale-resolved.
  final List<TourStepContent>? steps;

  /// Anchor key for tooltips (the app maps it to a view).
  final String? anchor;

  /// Report a tap on the CTA; routes the channel (url/faq/chat/whatsapp).
  final void Function() activateCta;

  /// Report the user dismissing the action.
  final void Function() dismiss;

  const ActionIntent({
    required this.actionId,
    required this.type,
    required this.variant,
    required this.content,
    this.steps,
    this.anchor,
    required this.activateCta,
    required this.dismiss,
  });
}

/// Server-driven Live Assist for a detected struggle (implementation mechanism).
class AssistIntent extends RenderIntent {
  final String actionId;
  final String mode; // "answer" | "fallback"

  /// Resolved title/body — the matched FAQ in answer mode, else authored copy.
  final String title;
  final String body;

  /// Escalation CTA from the action's authored content, if any.
  final String? ctaLabel;

  /// Answer mode: report "was this helpful?".
  final void Function() helpful;
  final void Function() unhelpful;

  /// Tap the escalate CTA (routes the channel).
  final void Function() escalate;

  const AssistIntent({
    required this.actionId,
    required this.mode,
    required this.title,
    required this.body,
    this.ctaLabel,
    required this.helpful,
    required this.unhelpful,
    required this.escalate,
  });
}

/// A single FAQ/help-center article.
class FaqArticle {
  final String id;
  final String title;
  final String body;
  const FaqArticle({required this.id, required this.title, required this.body});
}

/// FAQ launch (cta kind "faq"): pre-fetched published articles.
class FaqIntent extends RenderIntent {
  final List<FaqArticle> articles;

  /// Re-query the help center.
  final Future<List<FaqArticle>> Function(String query) search;

  const FaqIntent({required this.articles, required this.search});
}

/// Result of a single chat turn.
class ChatReply {
  final String reply;
  final bool escalate;
  const ChatReply({required this.reply, required this.escalate});
}

/// AI chat launch (cta kind "chat"): a live grounded-Agent conversation.
class ChatIntent extends RenderIntent {
  final Future<ChatReply> Function(String message) send;
  const ChatIntent({required this.send});
}

/// The platform SDK's renderer — receives intents, draws native UI.
abstract class Renderer {
  void show(RenderIntent intent);
}

// ── Config ───────────────────────────────────────────────────────────────────

/// Construction config for [createTracki].
class TrackiConfig {
  /// Project public key (pk_…).
  final String key;

  /// Ingest origin, e.g. https://ingest.tracki.app
  final String endpoint;
  final DeviceInfo device;
  final KeyValueStorage storage;

  /// UI locale for resolved content; Arabic-first default ("ar").
  final String? locale; // "ar" | "en"
  final Renderer? renderer;

  /// Open an external URL (wa.me deep link, cta url). Required for those CTAs.
  final void Function(String url)? openUrl;
  final Transport? transport;
  final Clock? clock;

  /// Test seam: ids default to a uuid-based factory.
  final IdFactory? idFactory;

  const TrackiConfig({
    required this.key,
    required this.endpoint,
    required this.device,
    required this.storage,
    this.locale,
    this.renderer,
    this.openUrl,
    this.transport,
    this.clock,
    this.idFactory,
  });
}
