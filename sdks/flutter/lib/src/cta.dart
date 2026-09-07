import 'dart:async';

import 'queue.dart';
import 'types.dart';

/// Effective channel kind.
enum CtaKind { url, faq, chat, whatsapp }

/// Effective channel, tolerating pre-implementation shapes (faq boolean / url-only).
CtaKind ctaKind(CtaContent cta) {
  switch (cta.kind) {
    case 'faq':
      return CtaKind.faq;
    case 'chat':
      return CtaKind.chat;
    case 'whatsapp':
      return CtaKind.whatsapp;
    case 'url':
      return CtaKind.url;
  }
  return (cta.faq ?? false) ? CtaKind.faq : CtaKind.url;
}

/// Minimal identity surface the router needs.
abstract class IdentityView {
  String getAnonId();
  String currentSession();
  String? getUserId();
}

final _httpUrl = RegExp(r'^https?://', caseSensitive: false);
final _httpsUrl = RegExp(r'^https://', caseSensitive: false);

/// Channel router (implementation "right channeling", mobile edition): a CTA opens a
/// URL, the FAQ help center, the grounded Agent chat, or a WhatsApp handoff —
/// all against the existing public APIs. Fail-silent throughout.
class CtaRouter {
  final String key;
  final String endpoint;
  final String Function() locale;

  /// Device platform stamped on handoffs so the inbox can label the surface.
  final String Function() platform;
  final String Function() currentPath;
  final EventQueue queue;
  final Transport transport;
  final Renderer? renderer;
  final void Function(String url)? openUrl;
  final IdentityView identity;
  final Clock now;

  CtaRouter({
    required this.key,
    required this.endpoint,
    required this.locale,
    required this.platform,
    required this.currentPath,
    required this.queue,
    required this.transport,
    required this.renderer,
    required this.openUrl,
    required this.identity,
    required this.now,
  });

  Future<List<FaqArticle>> searchFaq(String query) async {
    try {
      final data = await transport.get(
        '$endpoint/v1/faq?key=${Uri.encodeComponent(key)}&q=${Uri.encodeComponent(query)}',
      );
      final articles = (data is Map) ? data['articles'] : null;
      if (articles is List) {
        return articles
            .whereType<Map>()
            .map((a) => FaqArticle(
                  id: '${a['id'] ?? ''}',
                  title: '${a['title'] ?? ''}',
                  body: '${a['body'] ?? ''}',
                ))
            .toList();
      }
      return const [];
    } catch (_) {
      return const [];
    }
  }

  void openFaq() {
    final r = renderer;
    if (r == null) return;
    searchFaq('').then((articles) {
      r.show(FaqIntent(articles: articles, search: searchFaq));
    });
  }

  void openChat() {
    final r = renderer;
    if (r == null) return;
    String? conversationId;
    r.show(ChatIntent(send: (message) async {
      try {
        final body = <String, Object?>{
          'key': key,
          'anonId': identity.getAnonId(),
          'sessionId': identity.currentSession(),
        };
        final uid = identity.getUserId();
        if (uid != null) body['userId'] = uid;
        if (conversationId != null) body['conversationId'] = conversationId;
        body['message'] = message;
        body['path'] = currentPath();
        final data = await transport.post('$endpoint/v1/chat', body);
        if (data is Map) {
          final cid = data['conversationId'];
          if (cid is String && cid.isNotEmpty) conversationId = cid;
          return ChatReply(
            reply: '${data['reply'] ?? ''}',
            escalate: data['escalate'] == true,
          );
        }
        return const ChatReply(reply: '', escalate: false);
      } catch (_) {
        return const ChatReply(reply: '', escalate: true);
      }
    }));
  }

  /// Mint a implementation handoff and open the wa.me deep link (the ME killer flow).
  void openWhatsApp() {
    transport.post('$endpoint/v1/handoff', <String, Object?>{
      'key': key,
      'anonId': identity.getAnonId(),
      'sessionId': identity.currentSession(),
      'path': currentPath(),
      'locale': locale(),
      'platform': platform(),
    }).then((data) {
      final link = (data is Map) ? data['deepLink'] : null;
      if (link is String && _httpsUrl.hasMatch(link)) openUrl?.call(link);
    }).catchError((_) {});
  }

  /// Route a CTA tap to its channel. Returns the resolved kind (for telemetry).
  CtaKind activate(CtaContent cta) {
    final kind = ctaKind(cta);
    switch (kind) {
      case CtaKind.url:
        final u = cta.url;
        if (u != null && _httpUrl.hasMatch(u)) openUrl?.call(u);
        break;
      case CtaKind.faq:
        openFaq();
        break;
      case CtaKind.chat:
        openChat();
        break;
      case CtaKind.whatsapp:
        openWhatsApp();
        break;
    }
    return kind;
  }
}
