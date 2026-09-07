/**
 * Crude load check for AC6 (ack p95 < 100ms @ 1000 events/s). Fires batches at
 * the running ingest server and reports ack latency percentiles. Requires a
 * valid pk_ key (pass as argv[2] or TRACKI_BENCH_KEY) and the server up.
 *
 *   pnpm --filter @tracki/ingest bench -- pk_xxx
 */
const key = process.argv[2] ?? process.env.TRACKI_BENCH_KEY;
const endpoint = process.env.INGEST_URL ?? "http://localhost:4000/v1/events";
const DURATION_MS = 5000;
const TARGET_PER_SEC = 1000;
const BATCH = 10;

if (!key) {
  console.error("Usage: bench/load.ts <pk_key>  (or set TRACKI_BENCH_KEY)");
  process.exit(1);
}

function makeBatch() {
  return {
    key,
    anonId: `anon_${Math.floor(Math.random() * 10000)}`,
    sessionId: "sess_bench",
    sentAt: Date.now(),
    events: Array.from({ length: BATCH }, () => ({
      type: "pageview" as const,
      ts: Date.now(),
      path: "/bench",
      url: "https://bench.sa/bench",
    })),
  };
}

async function main() {
  const latencies: number[] = [];
  const start = Date.now();
  const intervalMs = 1000 / (TARGET_PER_SEC / BATCH);
  let inFlight: Promise<void>[] = [];

  while (Date.now() - start < DURATION_MS) {
    const t0 = performance.now();
    const p = fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeBatch()),
    })
      .then(() => {
        latencies.push(performance.now() - t0);
      })
      .catch(() => {});
    inFlight.push(p);
    if (inFlight.length > 200) {
      await Promise.all(inFlight);
      inFlight = [];
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  await Promise.all(inFlight);

  latencies.sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.floor((latencies.length - 1) * p)]?.toFixed(1);
  console.info(`requests: ${latencies.length}`);
  console.info(`p50: ${pct(0.5)}ms  p95: ${pct(0.95)}ms  p99: ${pct(0.99)}ms`);
}

void main();
