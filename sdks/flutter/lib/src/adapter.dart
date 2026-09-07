import 'dart:async';

import 'types.dart';

/// In-memory storage (tests, and a sane no-persistence default).
class MemoryStorage implements KeyValueStorage {
  final Map<String, String> _data;
  MemoryStorage([Map<String, String>? seed]) : _data = {...?seed};

  @override
  Future<String?> get(String key) async => _data[key];

  @override
  Future<void> set(String key, String value) async {
    _data[key] = value;
  }
}

/// Bridges [KeyValueStorage] to a host's persistence (e.g. SharedPreferences)
/// without a Flutter dependency: pass the two async closures from the app.
///
/// ```dart
/// final prefs = await SharedPreferences.getInstance();
/// final storage = FunctionStorage(
///   getter: (k) async => prefs.getString(k),
///   setter: (k, v) async => prefs.setString(k, v),
/// );
/// ```
class FunctionStorage implements KeyValueStorage {
  final Future<String?> Function(String key) getter;
  final Future<void> Function(String key, String value) setter;

  FunctionStorage({required this.getter, required this.setter});

  @override
  Future<String?> get(String key) => getter(key);

  @override
  Future<void> set(String key, String value) => setter(key, value);
}
