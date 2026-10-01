# Native diagnostics performance budget

Use this as the representative HR adapter's initial acceptance budget. These
are engineering thresholds for the real native candidate, not measured claims
about Android/iOS. Record binary/runtime/update, device, OS, workload and SDK
artifact identity with results. Compare the same app with diagnostics off/on.

| Boundary | Initial gate |
| --- | --- |
| Initialization | p95 added time ≤25 ms; cold maximum ≤100 ms |
| App startup | p95 increase ≤50 ms and ≤5% on the same workload |
| Retained memory | steady incremental JS heap ≤2 MiB; RSS delta ≤10 MiB |
| Serialization | p95 ≤2 ms per ≤96 KiB batch; maximum ≤10 ms |
| Queue | ≤500 events /512 KiB; ≤23-hour event TTL |
| Routine request observations | adapter explicitly configures 10% success sampling; failures/slow requests retained |
| Idle network | no routine activity uploads; health heartbeat default5 minutes |
| CPU | ≤1% incremental process CPU during a ten-minute ordinary-use run |
| Network workload | 100 ordinary successful requests +one failure: ≤16 KiB diagnostic payload excluding TLS |

The SDK's generic default success sample rate remains1 for compatibility;
the production HR adapter must explicitly select0.1 before rollout. Do not
instrument high-frequency success signals without this bounded policy.

The repository benchmark runs50 independent injected-storage/transport clients
with100 routine requests (deterministically10 retained) andone error each.
Its measured initialization/serialization, logical disk-write and payload byte
results are a Node proxy. Logical rewrite bytes exceed retained queue bytes:
AsyncStorage rewrites a bounded queue document. CPU/RSS include Node/JIT/runtime
effects and cannot establish native battery or startup impact.

Run `node --expose-gc packages/mobile-core/bench/native-overhead.mjs` after the
core build for the proxy. Measure the above gates in provisioned native builds
before release acceptance; investigate any failure instead of relaxing a gate
to match a convenient result. Host-auth/provider initialization is measured
separately from Tracki-only initialization and remains on the startup comparison.
