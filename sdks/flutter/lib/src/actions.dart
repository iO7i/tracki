import 'dart:async';
import 'dart:convert';

import 'cta.dart';
import 'queue.dart';
import 'types.dart';

// Local mirror of the mobile manifest entry (zero deps, like the snippet's).
class _Localized {
  final String title;
  final String body;
  final CtaContent? cta;
  const _Localized({required this.title, required this.body, this.cta});

  static _Localized fromJson(Map j) {
    CtaContent? cta;
    final c = j['cta'];
    if (c is Map) {
      cta = CtaContent(
        label: '${c['label'] ?? ''}',
        kind: c['kind'] as String?,
        url: c['url'] as String?,
        faq: c['faq'] is bool ? c['faq'] as bool : null,
      );
    }
    return _Localized(
      title: '${j['title'] ?? ''}',
      body: '${j['body'] ?? ''}',
      cta: cta,
    );
  }
}

class _TourStep {
  final Map<String, String> ar;
  final Map<String, String> en;
  final String? anchor;
  const _TourStep({required this.ar, required this.en, this.anchor});
}

class _ManifestAction {
  final String id;
  final String type; // popup | banner | tooltip | tour | drawer
  final _Localized arContent;
  final _Localized enContent;
  final _Localized? arContentB;
  final _Localized? enContentB;
  final String triggerKind;
  final int? triggerSeconds;
  final String? triggerEventName;
  final String? urlContains;
  final int? frequencyCap;
  final String? goalEvent;
  final String? anchorSelector;
  final List<_TourStep>? steps;

  _ManifestAction({
    required this.id,
    required this.type,
    required this.arContent,
    required this.enContent,
    this.arContentB,
    this.enContentB,
    required this.triggerKind,
    this.triggerSeconds,
    this.triggerEventName,
    this.urlContains,
    this.frequencyCap,
    this.goalEvent,
    this.anchorSelector,
    this.steps,
  });

  bool get hasB => arContentB != null || enContentB != null;

  static _ManifestAction? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['id'];
    final type = raw['type'];
    final content = raw['content'];
    final trigger = raw['trigger'];
    if (id is! String || type is! String || content is! Map || trigger is! Map) {
      return null;
    }
    final contentB = raw['contentB'];
    List<_TourStep>? steps;
    final rawSteps = raw['steps'];
    if (rawSteps is List) {
      steps = rawSteps.whereType<Map>().map((s) {
        final ar = (s['ar'] is Map) ? s['ar'] as Map : const {};
        final en = (s['en'] is Map) ? s['en'] as Map : const {};
        return _TourStep(
          ar: {'title': '${ar['title'] ?? ''}', 'body': '${ar['body'] ?? ''}'},
          en: {'title': '${en['title'] ?? ''}', 'body': '${en['body'] ?? ''}'},
          anchor: s['anchor'] as String?,
        );
      }).toList();
    }
    return _ManifestAction(
      id: id,
      type: type,
      arContent: _Localized.fromJson((content['ar'] as Map?) ?? const {}),
      enContent: _Localized.fromJson((content['en'] as Map?) ?? const {}),
      arContentB: (contentB is Map && contentB['ar'] is Map)
          ? _Localized.fromJson(contentB['ar'] as Map)
          : null,
      enContentB: (contentB is Map && contentB['en'] is Map)
          ? _Localized.fromJson(contentB['en'] as Map)
          : null,
      triggerKind: '${trigger['kind'] ?? ''}',
      triggerSeconds: trigger['seconds'] is num ? (trigger['seconds'] as num).toInt() : null,
      triggerEventName: trigger['eventName'] as String?,
      urlContains: raw['urlContains'] as String?,
      frequencyCap: raw['frequencyCap'] is num ? (raw['frequencyCap'] as num).toInt() : null,
      goalEvent: raw['goalEvent'] as String?,
      anchorSelector: raw['anchorSelector'] as String?,
      steps: steps,
    );
  }
}

const _capsKey = 'tracki_caps';

/// Stable 50/50 split per visitor (mirrors shared pickVariant). Replicates the
/// JS `(h * 31 + code) | 0` 32-bit signed overflow exactly via [toSigned].
String pickVariant(String anonId, String actionId, bool hasB) {
  if (!hasB) return 'A';
  var h = 0;
  final s = '$anonId:$actionId';
  for (var i = 0; i < s.length; i++) {
    h = (h * 31 + s.codeUnitAt(i)).toSigned(32);
  }
  return h.abs() % 2 == 0 ? 'A' : 'B';
}

/// Mobile action engine — the snippet's actions runtime re-imagined for apps:
/// screen_view plays the role of pageview, app_background plays exit_intent,
/// `event` fires on track(); struggle actions stay server-driven (Live Assist).
/// Frequency caps persist across launches in one storage-backed JSON map.
class ActionEngine {
  final String key;
  final String endpoint;
  final String Function() locale;
  final String Function() currentPath;
  final String Function() anonId;
  final EventQueue queue;
  final Transport transport;
  final KeyValueStorage storage;
  final Renderer? renderer;
  final CtaRouter cta;
  final Clock now;

  final List<_ManifestAction> _actions = [];
  final Set<String> _shownThisScreen = {};
  final Set<String> _shownThisSession = {};
  Map<String, int> _caps = {};
  bool _capsLoaded = false;
  final List<Timer> _timers = [];

  ActionEngine({
    required this.key,
    required this.endpoint,
    required this.locale,
    required this.currentPath,
    required this.anonId,
    required this.queue,
    required this.transport,
    required this.storage,
    required this.renderer,
    required this.cta,
    required this.now,
  });

  void _emit(String type, String actionId, String variant, [String? channel]) {
    final props = <String, Object?>{'action_id': actionId, 'variant': variant};
    if (channel != null) props['channel'] = channel;
    queue.enqueue(EventInput(
      type: type,
      ts: now(),
      path: currentPath(),
      props: props,
    ));
  }

  Future<void> _loadCaps() async {
    try {
      final raw = await storage.get(_capsKey);
      final parsed = raw == null ? {} : jsonDecode(raw);
      _caps = (parsed is Map)
          ? parsed.map((k, v) => MapEntry('$k', (v as num).toInt()))
          : {};
    } catch (_) {
      _caps = {};
    }
    _capsLoaded = true;
  }

  void _bumpCap(_ManifestAction a) {
    _caps[a.id] = (_caps[a.id] ?? 0) + 1;
    storage.set(_capsKey, jsonEncode(_caps)).catchError((_) {});
  }

  LocalizedContent _localized(_ManifestAction a, String variant) {
    final L = locale();
    if (variant == 'B' && a.hasB) {
      final b = L == 'en' ? (a.enContentB ?? a.arContentB) : (a.arContentB ?? a.enContentB);
      if (b != null) {
        return LocalizedContent(title: b.title, body: b.body, cta: b.cta);
      }
    }
    final pack = L == 'en' ? a.enContent : a.arContent;
    return LocalizedContent(title: pack.title, body: pack.body, cta: pack.cta);
  }

  List<TourStepContent>? _tourSteps(_ManifestAction a) {
    if (a.type != 'tour' || a.steps == null || a.steps!.isEmpty) return null;
    final L = locale();
    return a.steps!.map((s) {
      final m = L == 'en' ? s.en : s.ar;
      return TourStepContent(
        title: m['title'] ?? '',
        body: m['body'] ?? '',
        anchor: s.anchor,
      );
    }).toList();
  }

  void _maybeShow(_ManifestAction a) {
    final r = renderer;
    if (r == null) return;
    if (_shownThisScreen.contains(a.id)) return;
    if (a.urlContains != null && !currentPath().contains(a.urlContains!)) return;
    if (a.frequencyCap != null && (_caps[a.id] ?? 0) >= a.frequencyCap!) return;
    final variant = pickVariant(anonId(), a.id, a.hasB);
    final content = _localized(a, variant);
    final intent = ActionIntent(
      actionId: a.id,
      type: a.type,
      variant: variant,
      content: content,
      steps: _tourSteps(a),
      anchor: a.anchorSelector,
      activateCta: () {
        final c = content.cta;
        if (c == null) return;
        final kind = cta.activate(c);
        _emit('action_click', a.id, variant, kind.name);
      },
      dismiss: () => _emit('action_dismiss', a.id, variant),
    );
    try {
      r.show(intent);
    } catch (_) {
      // Audit slice-3 M1 parity: a failed render is NOT an impression.
      return;
    }
    _shownThisScreen.add(a.id);
    _shownThisSession.add(a.id);
    _bumpCap(a);
    _emit('action_impression', a.id, variant);
  }

  void _evaluateScreen() {
    for (final a in _actions) {
      if (a.triggerKind == 'pageview') _maybeShow(a);
    }
  }

  /// Fetch the mobile-surface manifest, then arm time-based triggers.
  Future<void> start() async {
    await _loadCaps();
    try {
      final data = await transport.get(
        '$endpoint/v1/actions?key=${Uri.encodeComponent(key)}&surface=mobile',
      );
      final list = (data is Map) ? data['actions'] : null;
      if (list is List) {
        for (final raw in list) {
          final a = _ManifestAction.fromJson(raw);
          if (a != null) _actions.add(a);
        }
      }
    } catch (_) {
      // fail-silent
    }
    _evaluateScreen();
    for (final a in _actions) {
      if (a.triggerKind == 'time_on_page') {
        final secs = a.triggerSeconds ?? 5;
        _timers.add(Timer(Duration(seconds: secs), () => _maybeShow(a)));
      }
    }
  }

  /// New screen — screen-scoped impressions reset, pageview triggers re-run.
  void onScreen() {
    _shownThisScreen.clear();
    if (_capsLoaded) _evaluateScreen();
  }

  /// App went to background — the mobile analogue of exit intent.
  void onBackground() {
    for (final a in _actions) {
      if (a.triggerKind == 'exit_intent') _maybeShow(a);
    }
  }

  /// A custom event — event triggers + goal attribution.
  void onTrack(String name) {
    for (final a in _actions) {
      if (a.triggerKind == 'event' && a.triggerEventName == name) _maybeShow(a);
      if (a.goalEvent == name && _shownThisSession.contains(a.id)) {
        _emit('action_goal', a.id, pickVariant(anonId(), a.id, a.hasB));
      }
    }
  }

  /// Test seam.
  int get loadedCount => _actions.length;
}
