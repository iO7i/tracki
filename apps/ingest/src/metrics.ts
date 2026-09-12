/**
 * Small dependency-free process metrics surface. Values are aggregate only:
 * event payloads, keys, visitor IDs, and provider responses never enter it.
 * Prometheus/OpenMetrics exporters can scrape /metrics without another service.
 */

type Histogram = { count: number; sum: number; samples: number[] };

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const histograms = new Map<string, Histogram>();
const MAX_SAMPLES = 10_000;

export function inc(name: string, value = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + value);
}

export function setGauge(name: string, value: number): void {
  gauges.set(name, Number.isFinite(value) ? value : 0);
}

export function observe(name: string, value: number): void {
  if (!Number.isFinite(value)) return;
  const h = histograms.get(name) ?? { count: 0, sum: 0, samples: [] };
  h.count += 1;
  h.sum += value;
  if (h.samples.length < MAX_SAMPLES) h.samples.push(value);
  else h.samples[h.count % MAX_SAMPLES] = value;
  histograms.set(name, h);
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

function metricName(name: string): string {
  return `tracki_${name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

/** A stable, JSON-safe snapshot used by operational test harnesses. */
export function snapshot(): {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, { count: number; sum: number; p50: number; p95: number; p99: number }>;
} {
  return {
    counters: Object.fromEntries(counters),
    gauges: Object.fromEntries(gauges),
    histograms: Object.fromEntries(
      [...histograms.entries()].map(([name, h]) => [
        name,
        {
          count: h.count,
          sum: h.sum,
          p50: percentile(h.samples, 0.5),
          p95: percentile(h.samples, 0.95),
          p99: percentile(h.samples, 0.99),
        },
      ]),
    ),
  };
}

/** Render counters, gauges, and quantile summaries in scrape-friendly text. */
export function prometheus(): string {
  const lines: string[] = [];
  for (const [name, value] of counters) {
    const n = metricName(name);
    lines.push(`# TYPE ${n} counter`, `${n} ${value}`);
  }
  for (const [name, value] of gauges) {
    const n = metricName(name);
    lines.push(`# TYPE ${n} gauge`, `${n} ${value}`);
  }
  for (const [name, h] of histograms) {
    const n = metricName(name);
    lines.push(`# TYPE ${n} summary`);
    for (const [q, p] of [
      ["0.5", 0.5],
      ["0.95", 0.95],
      ["0.99", 0.99],
    ] as const) {
      lines.push(`${n}{quantile="${q}"} ${percentile(h.samples, p)}`);
    }
    lines.push(`${n}_count ${h.count}`, `${n}_sum ${h.sum}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Test isolation seam; production never calls this. */
export function resetMetrics(): void {
  counters.clear();
  gauges.clear();
  histograms.clear();
}
