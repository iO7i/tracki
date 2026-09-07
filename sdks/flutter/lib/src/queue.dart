import 'dart:async';

import 'identity.dart';
import 'types.dart';

/// Same cadence as the web snippet.
const int flushSize = 10;
const int flushIntervalMs = 5000;

/// /v1/events caps a batch at 50 events — split larger buffers.
const int _maxBatch = 50;

/// Buffers events and flushes on size / interval / app-background. The ingest
/// response may carry a pending Live Assist — surfaced via the response handler.
class EventQueue {
  final String _key;
  final String _eventsUrl;
  final Identity _identity;
  final DeviceInfo _device;
  final Transport _transport;
  final Clock _now;

  final List<EventInput> _buffer = [];
  Timer? _timer;
  void Function(Object? data)? _onResponse;
  Future<void> _inflight = Future<void>.value();

  EventQueue(
    this._key,
    this._eventsUrl,
    this._identity,
    this._device,
    this._transport,
    this._now,
  );

  void setResponseHandler(void Function(Object? data) fn) {
    _onResponse = fn;
  }

  void enqueue(EventInput event) {
    _identity.touchSession();
    _buffer.add(event);
    if (_buffer.length >= flushSize) {
      flush();
    } else if (_timer == null) {
      _timer = Timer(
        const Duration(milliseconds: flushIntervalMs),
        () => flush(),
      );
    }
  }

  /// Send everything buffered. Serialized so batches arrive in order.
  Future<void> flush() {
    if (_timer != null) {
      _timer!.cancel();
      _timer = null;
    }
    if (_buffer.isEmpty) return _inflight;
    final events = List<EventInput>.from(_buffer);
    _buffer.clear();
    _inflight = _inflight.then((_) async {
      for (var i = 0; i < events.length; i += _maxBatch) {
        final end = (i + _maxBatch < events.length) ? i + _maxBatch : events.length;
        final batch = Batch(
          key: _key,
          anonId: _identity.getAnonId(),
          userId: _identity.getUserId(),
          sessionId: _identity.currentSession(),
          sentAt: _now(),
          device: _device,
          events: events.sublist(i, end),
        );
        try {
          final data = await _transport.post(_eventsUrl, batch.toJson());
          if (data != null) _onResponse?.call(data);
        } catch (_) {
          // fail-silent: behavioral telemetry must never break the host app
        }
      }
    });
    return _inflight;
  }

  /// Test helper.
  int get size => _buffer.length;
}
