import 'cta.dart';
import 'queue.dart';
import 'types.dart';

class _AssistContentWire {
  final String title;
  final String body;
  final CtaContent? cta;
  const _AssistContentWire({required this.title, required this.body, this.cta});

  static _AssistContentWire fromJson(Map j) {
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
    return _AssistContentWire(
      title: '${j['title'] ?? ''}',
      body: '${j['body'] ?? ''}',
      cta: cta,
    );
  }
}

class _AssistPayload {
  final String actionId;
  final String mode; // "answer" | "fallback"
  final _AssistContentWire arContent;
  final _AssistContentWire enContent;
  final Map<String, String>? arArticle;
  final Map<String, String>? enArticle;
  final String? articleId;

  const _AssistPayload({
    required this.actionId,
    required this.mode,
    required this.arContent,
    required this.enContent,
    this.arArticle,
    this.enArticle,
    this.articleId,
  });

  static _AssistPayload? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final actionId = raw['actionId'];
    final content = raw['content'];
    if (actionId is! String || content is! Map) return null;
    Map<String, String>? parseArticle(Object? a) {
      if (a is! Map) return null;
      return {'title': '${a['title'] ?? ''}', 'body': '${a['body'] ?? ''}'};
    }

    final article = raw['article'];
    return _AssistPayload(
      actionId: actionId,
      mode: '${raw['mode'] ?? 'fallback'}',
      arContent: _AssistContentWire.fromJson((content['ar'] as Map?) ?? const {}),
      enContent: _AssistContentWire.fromJson((content['en'] as Map?) ?? const {}),
      arArticle: (article is Map) ? parseArticle(article['ar']) : null,
      enArticle: (article is Map) ? parseArticle(article['en']) : null,
      articleId: raw['articleId'] as String?,
    );
  }
}

/// Server-driven Live Assist, mobile edition (slice 5 mechanism unchanged):
/// the worker matched a struggle to an action + FAQ and stashed the payload;
/// it arrives on an event-flush response and renders as a contextual drawer.
/// Once per session per action; fail-silent.
class AssistHandler {
  final String Function() locale;
  final String Function() currentPath;
  final EventQueue queue;
  final Renderer? renderer;
  final CtaRouter cta;
  final Clock now;

  final Set<String> _shown = {};

  AssistHandler({
    required this.locale,
    required this.currentPath,
    required this.queue,
    required this.renderer,
    required this.cta,
    required this.now,
  });

  void _emit(String type, _AssistPayload p) {
    final props = <String, Object?>{'action_id': p.actionId, 'mode': p.mode};
    if (p.articleId != null) props['article_id'] = p.articleId;
    queue.enqueue(EventInput(
      type: type,
      ts: now(),
      path: currentPath(),
      props: props,
    ));
  }

  void show(_AssistPayload payload) {
    final r = renderer;
    if (r == null || _shown.contains(payload.actionId)) return;
    final L = locale();
    final authored = L == 'en' ? payload.enContent : payload.arContent;
    var title = authored.title;
    var body = authored.body;
    if (payload.mode == 'answer' && (payload.arArticle != null || payload.enArticle != null)) {
      final candidate = L == 'en' ? payload.enArticle : payload.arArticle;
      final a = (candidate != null && (candidate['title'] ?? '').isNotEmpty)
          ? candidate
          : (payload.arArticle ?? payload.enArticle);
      if (a != null) {
        title = a['title'] ?? '';
        body = a['body'] ?? '';
      }
    }
    if (title.isEmpty && body.isEmpty) return;
    _shown.add(payload.actionId);

    final ctaContent = authored.cta;
    final intent = AssistIntent(
      actionId: payload.actionId,
      mode: payload.mode,
      title: title,
      body: body,
      ctaLabel: ctaContent?.label,
      helpful: () => _emit('assist_helpful', payload),
      unhelpful: () {
        _emit('assist_unhelpful', payload);
        // Parity with the snippet: an unhelpful answer offers the Agent.
        cta.openChat();
      },
      escalate: () {
        _emit('assist_escalate', payload);
        if (ctaContent != null) {
          final kind = ctaKind(ctaContent);
          if (kind == CtaKind.url) {
            cta.activate(ctaContent);
          } else if (kind == CtaKind.faq && ctaContent.kind == 'faq') {
            cta.openFaq();
          } else if (kind == CtaKind.whatsapp) {
            cta.openWhatsApp();
          } else {
            // chat — and the legacy slice-5 shape (faq:true, no kind), which
            // keeps its audited semantics of escalating to the Agent.
            cta.openChat();
          }
        }
      },
    );
    try {
      r.show(intent);
      _emit('assist_shown', payload);
    } catch (_) {
      // fail-silent
    }
  }

  /// Wire as the queue's response handler.
  void onResponse(Object? data) {
    final raw = (data is Map) ? data['assist'] : null;
    if (raw == null) return;
    final assist = _AssistPayload.fromJson(raw);
    if (assist != null) show(assist);
  }
}
