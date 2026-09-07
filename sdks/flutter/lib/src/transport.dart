import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'types.dart';

/// Default transport over `dart:io` HttpClient (no Flutter dependency, so the
/// conformance test runs under plain `dart test`). Fail-silent callers decide
/// what to do with errors.
class HttpTransport implements Transport {
  final HttpClient _client = HttpClient();

  @override
  Future<Object?> post(String url, Object? body) async {
    final req = await _client.postUrl(Uri.parse(url));
    req.headers.set(HttpHeaders.contentTypeHeader, 'application/json');
    req.add(utf8.encode(jsonEncode(body)));
    final res = await req.close();
    return _decode(res);
  }

  @override
  Future<Object?> get(String url) async {
    final req = await _client.getUrl(Uri.parse(url));
    final res = await req.close();
    return _decode(res);
  }

  Future<Object?> _decode(HttpClientResponse res) async {
    try {
      final text = await res.transform(utf8.decoder).join();
      if (text.isEmpty) return null;
      return jsonDecode(text);
    } catch (_) {
      return null;
    }
  }
}

/// Convenience constructor mirroring the reference's `fetchTransport()`.
Transport httpTransport() => HttpTransport();
