import { performance } from "node:perf_hooks";
import { createTracki, utf8Bytes } from "../dist/index.js";
const samples = [];
let bytesWritten = 0, bytesSent = 0;
const baseline = process.memoryUsage();
const cpu = process.cpuUsage();
for (let run = 0; run < 50; run++) {
  const data = new Map();
  const storage = { get: async key => data.get(key) ?? null, set: async (key, value) => { bytesWritten += utf8Bytes(value); data.set(key, value); } };
  const start = performance.now();
  const client = await createTracki({ key: "pk_benchmark", endpoint: "https://invalid.example", device: { platform: "android" }, storage,
    capturePolicy: { diagnostics: true, activity: false }, collectionBudget: { routineSuccessSampleRate: 0.1 }, sampleRandom: () => 0.9,
    transport: { get: async () => ({}), post: async (_, batch) => { bytesSent += utf8Bytes(JSON.stringify(batch)); return { acceptedClientIds: batch.events.map(event => event.eventId) }; } } });
  samples.push(performance.now() - start);
  for (let i = 0; i < 100; i++) client.diagnostic({ type: "track", ts: Date.now(), props: { name: "cco_response", statusCode: 200, durationMs: 1 } });
  client.error("JS_ERROR"); await client.flush(); client.dispose();
}
samples.sort((a, b) => a - b);
globalThis.gc?.();
const memory = process.memoryUsage();
console.log(JSON.stringify({ measurementKind: "Node adapter benchmark, not mobile device acceptance", runs: samples.length,
  initializationP50Ms: samples[24], initializationP95Ms: samples[47], initializationMaximumMs: samples[49],
  cpuMicroseconds: process.cpuUsage(cpu), heapDeltaBytes: memory.heapUsed - baseline.heapUsed,
  rssDeltaBytes: memory.rss - baseline.rss, logicalStorageBytesWritten: bytesWritten, transportBytes: bytesSent,
  perRunObserved: 101, perRunSampledOut: 100, perRunErrorsPreserved: 1 }, null, 2));
