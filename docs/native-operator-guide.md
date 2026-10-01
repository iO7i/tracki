# Native diagnostics: operator workflow

Start in Watchtower's native diagnostics overview, with the app, environment
and account selected. Aggregate health and incidents are the entry points;
individual events are investigation evidence.

1. Check collection health first. Last receipt, heartbeat age, queue depth,
   storage failures, expiry/capacity losses and sampling explain incomplete
   evidence. No events and no health report means unknown, not healthy.
2. Open an incident to see its fixed failure class, affected accounts and
   build/runtime/update. Acknowledge when investigation starts; resolve after
   observed recovery. Revision conflicts require reloading the current state.
3. Follow the correlated request/operation/job. Client HTTP acceptance means
   the backend accepted a request, not that the business action succeeded.
   A terminal server readback is authoritative finality. Job failure is evidence
   of that job; absent readback leaves business outcome unknown.
4. Compare releases only when the same environment, route and time window have
   sufficient samples. Sample-weighted request failures and latency are bounded
   observations, not proof that a release caused the difference.
5. Return to the existing authorized domain system for business inputs. Native
   diagnostics has no screens, typed values, transcript content, bodies or raw
   error stacks. It cannot recreate what the user saw.

## Integration and compatibility

The collector separates app, environment, account, installation and authority
generation. It rejects conflicting session/build/protocol relabeling. Opaque
IDs do not grant access or permit joining different stores.

Schema 2 is current; explicitly supported schema 1 is deprecated and legacy
capability sets are labeled. Unsupported bootstrap attempts do not create
accepted sessions: their fleet-wide count is unknown, not zero. Fixed rejection
categories are available on the device and accepted health reports.

## Acceptance and rollout

SDK unit tests, package installation, an isolated collector and rendered
Watchtower checks prove those boundaries only. The genuine HR mobile provider
must bind its verified session/company to the existing backend before real
end-to-end acceptance. Fixtures remain explicitly synthetic.

Before rollout, install Android/iOS development binaries and exercise delivery,
offline retry, background/resume, process restart, account/company switch,
logout, revocation, deep links and build/update identity. Check that old queued
evidence keeps its original identity and that health shows any losses.

Default SDK bounds: 500 events, 512 KiB outbox, 23-hour TTL, 50-event/96 KiB
batches, 5-minute health heartbeat (configurable 1–15 minutes). Routine successes
may be sampled; failures/slow requests are unsampled. Sampling/invalid health
counter writes coalesce up to one second; abrupt termination may lose that
interval. A stopped process cannot promise terminal crash delivery.

Node proxy overhead measurements are in the wave's native-overhead.json.
Device initialization, memory, serialization, bytes, CPU and startup impact
must be measured in the real native candidate before release certification.
