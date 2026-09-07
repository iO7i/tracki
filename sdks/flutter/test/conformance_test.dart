import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:test/test.dart';
import 'package:tracki_flutter/tracki_flutter.dart';

/// The Dart SDK must reproduce the shared conformance fixtures byte-for-byte
/// (as parsed JSON). The TS reference + Swift/Kotlin SDKs assert the SAME files
/// — this is what keeps the codebases on one protocol.

// ── Test doubles ─────────────────────────────────────────────────────────────

class _CapturingTransport implements Transport {
  final List<Map<String, Object?>> posts = [];

  @override
  Future<Object?> post(String url, Object? body) async {
    // Serialize exactly like a real HTTP transport would (drops absent keys).
    final encoded = jsonDecode(jsonEncode(body));
    posts.add({'url': url, 'body': encoded});
    return {'ok': true};
  }

  @override
  Future<Object?> get(String url) async => {'actions': []};
}

Map<String, Object?> _loadFixture(String name) {
  // `dart test` runs with the package root (sdks/flutter) as the working dir,
  // so ../conformance reaches the shared fixtures. A couple of fallbacks keep
  // the test robust to being invoked from a parent directory.
  final root = Directory.current.path;
  final candidates = [
    File('$root/../conformance/$name'),
    File('$root/../../conformance/$name'),
    File('$root/sdks/conformance/$name'),
  ];
  for (final f in candidates) {
    if (f.existsSync()) {
      return jsonDecode(f.readAsStringSync()) as Map<String, Object?>;
    }
  }
  throw StateError('conformance fixture not found: $name');
}

/// Per-prefix counter id factory: anon_1, sess_1, …
IdFactory _idFactory() {
  final counters = <String, int>{};
  return (prefix) {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return '${prefix}_${counters[prefix]}';
  };
}

/// Dispatch a scripted step onto the client (Dart has no string-keyed method
/// dispatch, so this mirrors the TS `client[step.call](...args)`).
void _dispatch(TrackiClient c, String call, List<Object?> args) {
  switch (call) {
    case 'screen':
      c.screen(args[0] as String,
          args.length > 1 ? (args[1] as Map).cast<String, Object?>() : null);
      break;
    case 'otp':
      c.otp(args[0] as String,
          args.length > 1 ? (args[1] as Map).cast<String, Object?>() : null);
      break;
    case 'biometric':
      c.biometric(args[0] as String,
          args.length > 1 ? (args[1] as Map).cast<String, Object?>() : null);
      break;
    case 'payment':
      c.payment(args[0] as String,
          args.length > 1 ? (args[1] as Map).cast<String, Object?>() : null);
      break;
    case 'flow':
      c.flow(args[0] as String, args[1] as String,
          args.length > 2 ? (args[2] as Map).cast<String, Object?>() : null);
      break;
    case 'track':
      c.track(args[0] as String,
          args.length > 1 ? (args[1] as Map).cast<String, Object?>() : null);
      break;
    case 'identify':
      c.identify(args[0] as String);
      break;
    case 'deepLink':
      c.deepLink(args[0] as String, args.length > 1 ? args[1] as bool : true);
      break;
    case 'pushOpen':
      c.pushOpen(args.isNotEmpty ? (args[0] as Map).cast<String, Object?>() : null);
      break;
    case 'backNav':
      c.backNav();
      break;
    case 'appForeground':
      c.appForeground(args.isNotEmpty ? args[0] as String : 'warm');
      break;
    case 'appBackground':
      c.appBackground();
      break;
    case 'error':
      c.error(args[0] as String);
      break;
    case 'permissionDenied':
      c.permissionDenied(args[0] as String);
      break;
    default:
      throw StateError('unknown scripted call: $call');
  }
}

Future<({TrackiClient client, _CapturingTransport transport})> _runJourney(
  Map<String, Object?> journey, {
  Renderer? renderer,
}) async {
  var t = 1700000000000;
  final transport = _CapturingTransport();
  final config = journey['config'] as Map<String, Object?>;
  final dev = config['device'] as Map<String, Object?>;
  final client = await createTracki(TrackiConfig(
    key: config['key'] as String,
    endpoint: config['endpoint'] as String,
    locale: config['locale'] as String?,
    device: DeviceInfo.fromJson(dev),
    storage: MemoryStorage(),
    transport: transport,
    clock: () => t,
    idFactory: _idFactory(),
    renderer: renderer,
  ));
  await client.ready;
  for (final step in (journey['script'] as List).cast<Map<String, Object?>>()) {
    t += 1000; // the fixture clock: +1000ms before each step
    _dispatch(client, step['call'] as String,
        (step['args'] as List).cast<Object?>());
  }
  await client.flush();
  return (client: client, transport: transport);
}

// ── Tests ────────────────────────────────────────────────────────────────────

void main() {
  final journey = _loadFixture('journey-batch.json');
  final channels = _loadFixture('channel-requests.json');

  test('pickVariant replicates the JS 32-bit hash exactly', () {
    // Known values computed from the TS reference logic:
    //   h = (h*31 + charCode)|0 over "anonId:actionId", abs(h)%2 → A/B.
    // hasB=false short-circuits to "A".
    expect(pickVariant('anon_1', 'act-1', false), 'A');
    // "anon_1:act-1" → A (even hash); "anon_2:act-1" → B (odd hash).
    expect(pickVariant('anon_1', 'act-1', true), 'A');
    expect(pickVariant('anon_2', 'act-1', true), 'B');
  });

  test('produces exactly the expected /v1/events batch', () async {
    final r = await _runJourney(journey);
    final batches = r.transport.posts
        .where((p) => (p['url'] as String).endsWith('/v1/events'))
        .toList();
    expect(batches.length, 1);
    expect(batches.first['body'], equals(journey['expectedBatch']));
  });

  test('mints the exact WhatsApp handoff body', () async {
    final r = await _runJourney(journey);
    r.client.openWhatsApp();
    await Future<void>.delayed(Duration.zero);
    final handoffSpec = channels['whatsappHandoff'] as Map<String, Object?>;
    final handoff = r.transport.posts.firstWhere(
        (p) => (p['url'] as String).endsWith(handoffSpec['url'] as String));
    expect(handoff['body'], equals(handoffSpec['body']));
  });

  test('sends the exact first chat turn', () async {
    final intents = <RenderIntent>[];
    final renderer = _ListRenderer(intents);
    final r = await _runJourney(journey, renderer: renderer);
    r.client.openChat();
    final chat = intents.whereType<ChatIntent>().first;
    final chatSpec = channels['chatFirstTurn'] as Map<String, Object?>;
    await chat.send(chatSpec['messageUsed'] as String);
    final turn = r.transport.posts.firstWhere(
        (p) => (p['url'] as String).endsWith(chatSpec['url'] as String));
    expect(turn['body'], equals(chatSpec['body']));
  });
}

class _ListRenderer implements Renderer {
  final List<RenderIntent> sink;
  _ListRenderer(this.sink);
  @override
  void show(RenderIntent intent) => sink.add(intent);
}
