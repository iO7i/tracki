import { describe, expect, it } from "vitest";
import { inc, observe, prometheus, resetMetrics, setGauge, snapshot } from "./metrics";

describe("operational metrics", () => {
  it("exposes aggregate counters, gauges, and latency quantiles without payloads", () => {
    resetMetrics();
    inc("events_accepted_total", 3);
    setGauge("pending_events", 2);
    observe("event_acceptance_latency_ms", 4);
    observe("event_acceptance_latency_ms", 12);

    expect(snapshot()).toMatchObject({
      counters: { events_accepted_total: 3 },
      gauges: { pending_events: 2 },
      histograms: {
        event_acceptance_latency_ms: { count: 2, p50: 4, p95: 4, p99: 4 },
      },
    });
    const text = prometheus();
    expect(text).toContain("tracki_events_accepted_total 3");
    expect(text).toContain("tracki_pending_events 2");
    expect(text).not.toContain("payload");
  });
});
