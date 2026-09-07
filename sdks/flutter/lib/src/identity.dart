import 'dart:math';

import 'types.dart';

const _anonKey = 'tracki_anon';
const _userKey = 'tracki_user';
const _sessionKey = 'tracki_session';
const _sessionTsKey = 'tracki_session_ts';

/// Same rotation rule as the web snippet: 30 min of inactivity = new session.
const int sessionTimeoutMs = 30 * 60 * 1000;

final _rng = Random();

/// Default id factory; prefers a v4-style uuid, falls back to time+random.
String defaultIdFactory(String prefix) {
  return '${prefix}_${_uuidV4()}';
}

String _uuidV4() {
  final bytes = List<int>.generate(16, (_) => _rng.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}';
}

/// Visitor identity over an injected async store. Hydrated once at init; all
/// reads are then synchronous in-memory, writes persist fire-and-forget (the
/// memory copy is authoritative for the process lifetime — mirroring the
/// snippet's localStorage-with-memory-fallback semantics).
class Identity {
  final KeyValueStorage _storage;
  final Clock _now;
  final IdFactory _newId;

  String _anonId = '';
  String? _userId;
  String _sessionId = '';
  int _lastActivity = 0;

  Identity(this._storage, this._now, [IdFactory? newId])
      : _newId = newId ?? defaultIdFactory;

  /// Load persisted identity; create what's missing. Call once before use.
  Future<void> hydrate() async {
    final results = await Future.wait<String?>([
      _storage.get(_anonKey).catchError((_) => null),
      _storage.get(_userKey).catchError((_) => null),
      _storage.get(_sessionKey).catchError((_) => null),
      _storage.get(_sessionTsKey).catchError((_) => null),
    ]);
    final anon = results[0];
    final user = results[1];
    final sess = results[2];
    final ts = results[3];
    _anonId = (anon != null && anon.isNotEmpty)
        ? anon
        : _persist(_anonKey, _newId('anon'));
    _userId = (user != null && user.isNotEmpty) ? user : null;
    _sessionId = sess ?? '';
    _lastActivity = ts == null ? 0 : (int.tryParse(ts) ?? 0);
    // Ensure a valid session exists (also rotates an expired persisted one).
    touchSession();
  }

  String _persist(String key, String value) {
    _storage.set(key, value).catchError((_) {});
    return value;
  }

  String getAnonId() => _anonId;

  String? getUserId() => _userId;

  void setUserId(String userId) {
    _userId = userId;
    _persist(_userKey, userId);
  }

  /// Current session id; rotates after 30 min of inactivity, stamps activity.
  String touchSession() {
    final t = _now();
    if (_sessionId.isEmpty || t - _lastActivity > sessionTimeoutMs) {
      _sessionId = _persist(_sessionKey, _newId('sess'));
    }
    _lastActivity = t;
    _persist(_sessionTsKey, '$t');
    return _sessionId;
  }

  /// Read without stamping activity (used when building batches).
  String currentSession() => _sessionId;
}
