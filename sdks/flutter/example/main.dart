import 'package:flutter/material.dart';
import 'package:tracki_flutter/tracki_flutter.dart';

void main() => runApp(const TrackiConsumer());

/// Minimal consumer proof: the public package/config resolve in a Flutter app.
class TrackiConsumer extends StatelessWidget {
  const TrackiConsumer({super.key});

  @override
  Widget build(BuildContext context) {
    final config = TrackiConfig(
      key: 'pk_consumer',
      endpoint: 'https://ingest.example',
      device: const DeviceInfo(platform: 'android', sdk: 'flutter'),
      storage: MemoryStorage(),
    );
    return MaterialApp(
      home: Scaffold(
        appBar: AppBar(title: const Text('Tracki consumer')),
        body: Center(child: Text(config.device.sdk ?? 'unknown')),
      ),
    );
  }
}
