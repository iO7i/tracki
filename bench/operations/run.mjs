import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const seed = String(args.seed ?? "tracki-operations-v1");
const key = args.key ?? process.env.TRACKI_BENCH_KEY;
const configuredKeys = String(args.keys ?? process.env.TRACKI_BENCH_KEYS ?? key ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const benchKeys = configuredKeys.length
  ? configuredKeys
  : ["pk_synthetic_org_a", "pk_synthetic_org_b"];
const endpoint = String(
  args.endpoint ?? process.env.INGEST_URL ?? "http://localhost:4000/v1/events",
);
const metricsEndpoint = String(
  args["metrics-endpoint"] ?? process.env.INGEST_METRICS_URL ?? new URL("/metrics", endpoint),
);
const dryRun = args["dry-run"] === true || configuredKeys.length === 0;
const durationMs = positiveNumber(args["duration-ms"], 5_000);
const intervalMs = positiveNumber(args["interval-ms"], 250);
const recoveryMs = nonNegativeNumber(args["recovery-ms"], 0);
const batchSize = Math.max(1, Math.min(50, positiveNumber(args["batch-size"], 8)));
const duplicateEvery = Math.max(0, Number(args["duplicate-every"] ?? 7));
const maxErrorRate = Number(args["max-error-rate"] ?? 0.01);
const maxP95Ms = Number(args["max-p95-ms"] ?? 1_000);
const levels = String(args.levels ?? "1,5,10,25")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const output = String(args.output ?? `evidence/operations/${runId}`);
const rng = seeded(seed);
const raw = {
  schemaVersion: 1,
  runId,
  workload: {
    name: "realistic-mixed-mobile-and-web-sessions",
    version: "operations-v1",
    seed,
    endpoint,
    mode: dryRun ? "dry-run" : "http",
    durationMs,
    intervalMs,
    batchSize,
    duplicateEvery,
    recoveryMs,
    organizationCount: positiveNumber(args["organization-count"], Math.min(2, benchKeys.length)),
    projectCount: benchKeys.length,
    levels,
    contract:
      "A 202 response is counted as an acceptance response only; durable acceptance requires a valid project key and reconciliation.",
  },
  environment: environmentMetadata(),
  resourceUsage: { start: process.resourceUsage() },
  observability: {
    metricsEndpoint,
    before: null,
    after: null,
    recovery: null,
    note: dryRun
      ? "not_run: no keyed HTTP target was supplied"
      : "aggregate metrics only; scrape failures are recorded rather than inferred",
  },
  startedAt: new Date().toISOString(),
  levels: [],
};
raw.observability.before = await scrapeMetrics();

for (const clients of levels) {
  const level = await runLevel(clients);
  raw.levels.push(level);
  if (level.saturation.violated) break;
}
raw.observability.after = await scrapeMetrics();
if (recoveryMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, recoveryMs));
  raw.observability.recovery = await scrapeMetrics();
}
raw.finishedAt = new Date().toISOString();
raw.durationMs = Date.parse(raw.finishedAt) - Date.parse(raw.startedAt);
raw.resourceUsage.end = process.resourceUsage();

const summary = summarize(raw);
const report = renderReport(raw, summary);
await mkdir(output, { recursive: true });
await writeFile(`${output}/raw.json`, `${JSON.stringify(raw, null, 2)}\n`);
await writeFile(`${output}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(`${output}/report.md`, report);
const manifest = {
  schemaVersion: 1,
  runId,
  gitSha: gitSha(),
  workloadVersion: raw.workload.version,
  workloadSeed: seed,
  startedAt: raw.startedAt,
  finishedAt: raw.finishedAt,
  output,
  environment: raw.environment,
  artifacts: {},
};
for (const name of ["raw.json", "summary.json", "report.md"]) {
  const contents = await readFile(`${output}/${name}`);
  manifest.artifacts[name] = {
    sha256: createHash("sha256").update(contents).digest("hex"),
    bytes: contents.byteLength,
  };
}
await writeFile(`${output}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
// biome-ignore lint/suspicious/noConsole: command-line evidence summary
console.log(report);
// biome-ignore lint/suspicious/noConsole: command-line evidence path
console.log(`Evidence: ${output}/manifest.json`);

async function runLevel(clients) {
  const started = Date.now();
  const metricsBefore = await scrapeMetrics();
  const deadline = started + durationMs;
  const attempts = [];
  const states = Array.from({ length: clients }, (_, client) => ({
    client,
    sequence: 0,
    previous: null,
  }));
  await Promise.all(
    states.map(async (state) => {
      while (Date.now() < deadline) {
        const sequence = state.sequence++;
        const duplicate =
          duplicateEvery > 0 && sequence > 0 && sequence % duplicateEvery === 0 && state.previous;
        const batch = duplicate ? state.previous : makeBatch(state.client, sequence);
        if (!duplicate) state.previous = batch;
        const result = dryRun
          ? { status: null, latencyMs: 0, error: null, acceptedAt: null }
          : await post(batch);
        attempts.push({
          client: state.client,
          sequence,
          duplicateOf: duplicate ? `${state.client}:${sequence - 1}` : null,
          eventIds: batch.events.map((event) => event.eventId),
          eventCount: batch.events.length,
          ...result,
        });
        if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }),
  );
  const metricsAfter = await scrapeMetrics();
  const level = summarizeLevel(clients, started, attempts);
  return {
    ...level,
    observability: summarizeObservability(metricsBefore, metricsAfter, level.elapsedMs),
    attempts,
  };
}

function makeBatch(client, sequence) {
  const now = Date.now();
  const anonId = `anon_bench_${client}`;
  const sessionId = `sess_bench_${client}_${Math.floor(sequence / 120)}`;
  const paths = ["/home", "/catalog", "/checkout", "/payment", "/otp"];
  const path = paths[(sequence + client) % paths.length];
  const eventTypes = [
    "pageview",
    "click",
    "form_focus",
    "route_change",
    "track",
    "screen_view",
    "payment_start",
    "otp_fail",
  ];
  const events = Array.from({ length: batchSize }, (_, index) => {
    const type = eventTypes[(sequence * 3 + index + client) % eventTypes.length];
    const event = {
      eventId: `evt_bench_${safe(seed)}_${client}_${sequence}_${index}`.slice(0, 128),
      type,
      ts: now + index,
      path,
      props: {
        locale: rng() > 0.5 ? "ar" : "en",
        surface: client % 2 === 0 ? "mobile" : "web",
        index,
      },
    };
    if (type === "click") event.props = { ...event.props, tag: "button", id: "checkout-continue" };
    if (type === "track") event.props = { ...event.props, name: "catalog_view" };
    if (type === "payment_start") event.props = { ...event.props, method: "mada" };
    return event;
  });
  return {
    key: benchKeys[client % benchKeys.length],
    anonId,
    userId: client % 3 === 0 ? `user_bench_${client}` : undefined,
    sessionId,
    sentAt: now,
    ...(client % 2 === 0
      ? {
          device: {
            platform: "android",
            osVersion: "synthetic",
            appVersion: "bench-1",
            model: "simulator",
            sdk: "android",
          },
        }
      : {}),
    events,
  };
}

async function post(body) {
  const started = performance.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "tracki-operations-bench/1" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1_000, intervalMs * 8)),
    });
    return {
      status: response.status,
      latencyMs: performance.now() - started,
      acceptedAt: response.status >= 200 && response.status < 300 ? new Date().toISOString() : null,
      error: null,
    };
  } catch (error) {
    return {
      status: null,
      latencyMs: performance.now() - started,
      acceptedAt: null,
      error: String(error?.message ?? error),
    };
  }
}

function summarizeLevel(clients, started, attempts) {
  const elapsedMs = Math.max(1, Date.now() - started);
  const latency = attempts.map((attempt) => attempt.latencyMs).sort((a, b) => a - b);
  const responses = dryRun ? [] : attempts.filter((attempt) => attempt.status !== null);
  const accepted = responses.filter((attempt) => attempt.status >= 200 && attempt.status < 300);
  const failed = dryRun
    ? []
    : attempts.filter(
        (attempt) => attempt.status === null || attempt.status < 200 || attempt.status >= 300,
      );
  const p95 = percentile(latency, 0.95);
  const errorRate = attempts.length === 0 ? 0 : failed.length / attempts.length;
  return {
    clients,
    measurement: dryRun ? "not_run" : "measured",
    startedAt: new Date(started).toISOString(),
    elapsedMs,
    attemptedBatches: attempts.length,
    attemptedEvents: attempts.reduce((sum, attempt) => sum + attempt.eventCount, 0),
    responseAcceptedEvents: accepted.reduce((sum, attempt) => sum + attempt.eventCount, 0),
    duplicateReplayBatches: attempts.filter((attempt) => attempt.duplicateOf).length,
    statuses: dryRun
      ? { dry_run: attempts.length }
      : Object.fromEntries(
          [...new Set(attempts.map((attempt) => String(attempt.status ?? "network_error")))]
            .sort()
            .map((status) => [
              status,
              attempts.filter((attempt) => String(attempt.status ?? "network_error") === status)
                .length,
            ]),
        ),
    latencyMs: { p50: percentile(latency, 0.5), p95, p99: percentile(latency, 0.99) },
    requestRate: attempts.length / (elapsedMs / 1_000),
    attemptedEventsPerSecond:
      attempts.reduce((sum, attempt) => sum + attempt.eventCount, 0) / (elapsedMs / 1_000),
    acceptedEventsPerSecond:
      accepted.reduce((sum, attempt) => sum + attempt.eventCount, 0) / (elapsedMs / 1_000),
    errorRate,
    saturation: {
      criterion: { maxErrorRate, maxP95Ms },
      violated: !dryRun && attempts.length > 0 && (errorRate > maxErrorRate || p95 > maxP95Ms),
      reason:
        errorRate > maxErrorRate ? "error_rate" : p95 > maxP95Ms ? "p95_acceptance_latency" : null,
    },
  };
}

function summarizeObservability(before, after, elapsedMs) {
  const delta = (name) => {
    if (!(name in after.values)) return null;
    const value = (after.values[name] ?? 0) - (before.values[name] ?? 0);
    return value >= 0 ? value : null;
  };
  const rate = (value) => (value === null ? null : value / (Math.max(1, elapsedMs) / 1_000));
  const processedEvents = delta("tracki_events_processed_total");
  const detectorEvents = delta("tracki_detector_events_total");
  const clickhouseWrites = delta("tracki_clickhouse_events_write_latency_ms_count");
  return {
    before,
    after,
    processedEvents,
    processedEventsPerSecond: rate(processedEvents),
    detectorEvents,
    detectorEventsPerSecond: rate(detectorEvents),
    clickhouseEventWrites: clickhouseWrites,
    clickhouseEventWriteFailures: delta("tracki_clickhouse_events_write_failures_total"),
    pendingEvents: after.values.tracki_pending_events ?? null,
    oldestPendingAgeSeconds: after.values.tracki_oldest_pending_age_seconds ?? null,
    recoveryAfterLoad: "requires a separate post-load observation window and reconciliation",
  };
}

function summarize(result) {
  return {
    schemaVersion: 1,
    runId: result.runId,
    mode: result.workload.mode,
    validKeyRequiredForDurability: true,
    levels: result.levels.map(({ attempts, ...level }) => ({
      ...level,
      uniqueEventIds: new Set(attempts.flatMap((attempt) => attempt.eventIds)).size,
    })),
    saturation: result.levels.find((level) => level.saturation.violated)?.saturation ?? {
      criterion: { maxErrorRate, maxP95Ms },
      violated: false,
      reason: null,
      note: "No saturation boundary was reached during this run.",
    },
  };
}

function renderReport(result, summary) {
  const lines = [
    "# Tracki operational benchmark",
    "",
    `- Run: \`${result.runId}\``,
    `- Mode: **${result.workload.mode}**${result.workload.mode === "dry-run" ? " (no HTTP requests; this is not a system capacity measurement)" : ""}`,
    `- Workload: ${result.workload.name} ${result.workload.version}`,
    `- Seed: \`${result.workload.seed}\``,
    `- Endpoint: \`${result.workload.endpoint}\``,
    `- Scope: ${result.workload.organizationCount} organizations / ${result.workload.projectCount} projects`,
    `- Levels: ${result.workload.levels.join(", ")} simulated clients`,
    "",
    "## Results",
    "",
    "| Clients | Batches | Attempted events/s | Response-accepted events/s | p50 ms | p95 ms | p99 ms | Error rate | Duplicate replays |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const level of summary.levels) {
    lines.push(
      `| ${level.clients} | ${level.attemptedBatches} | ${level.attemptedEventsPerSecond.toFixed(2)} | ${level.acceptedEventsPerSecond.toFixed(2)} | ${level.latencyMs.p50.toFixed(2)} | ${level.latencyMs.p95.toFixed(2)} | ${level.latencyMs.p99.toFixed(2)} | ${(level.errorRate * 100).toFixed(2)}% | ${level.duplicateReplayBatches} |`,
    );
  }
  lines.push(
    "",
    "## Saturation boundary",
    "",
    summary.saturation.violated
      ? `The configured boundary was first violated by **${summary.saturation.reason}**.`
      : "No configured saturation boundary was reached.",
    "",
  );
  lines.push("## Processing and queue signals", "");
  for (const level of summary.levels) {
    const processing = level.observability;
    lines.push(
      `- ${level.clients} clients: processed ${formatMeasurement(processing?.processedEventsPerSecond)} events/s; detector ${formatMeasurement(processing?.detectorEventsPerSecond)} events/s; pending ${formatMeasurement(processing?.pendingEvents)}; oldest pending age ${formatMeasurement(processing?.oldestPendingAgeSeconds)} seconds; ClickHouse event-write failures ${formatMeasurement(processing?.clickhouseEventWriteFailures)}.`,
    );
  }
  lines.push(
    "",
    "A 202 is an HTTP acceptance response. It is not durable proof when the key is unknown; run the reconciliation command with a valid project key and database identifiers before making a durability claim.",
    "",
    "Raw attempts and generated summaries are preserved beside this report. Charts, if added, must be derived from `raw.json`.",
    "",
  );
  if (result.observability.recovery) {
    lines.push(
      `Recovery observation after ${result.workload.recoveryMs}ms: aggregate metrics were scraped after the load-drop wait; use the recorded snapshot and reconciliation to judge drain completion.`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function formatMeasurement(value) {
  return value === null || value === undefined ? "not captured" : Number(value).toFixed(2);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))] ?? 0;
}

function parseArgs(values) {
  const out = {};
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith("--")) continue;
    const [name, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) out[name] = inline;
    else if (values[i + 1] && !values[i + 1].startsWith("--")) out[name] = values[++i];
    else out[name] = true;
  }
  return out;
}

function positiveNumber(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function safe(value) {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 30);
}

function seeded(value) {
  let state = 0x811c9dc5;
  for (const char of value) state = Math.imul(state ^ char.charCodeAt(0), 0x01000193);
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function environmentMetadata() {
  const commandVersion = (command, args) => {
    try {
      return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        .trim()
        .split("\n")[0];
    } catch {
      return "unavailable";
    }
  };
  return {
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    cpuCount: os.cpus().length,
    memoryBytes: os.totalmem(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    node: process.version,
    docker: commandVersion("docker", ["version", "--format", "{{.Server.Version}}"]),
    postgres: process.env.POSTGRES_VERSION ?? "record from runtime/container",
    clickhouse: process.env.CLICKHOUSE_VERSION ?? "record from runtime/container",
    redis: process.env.REDIS_VERSION ?? "record from runtime/container",
    workerCount: process.env.TRACKI_WORKER_COUNT ?? "not declared",
    ingestProcessCount: process.env.TRACKI_INGEST_PROCESS_COUNT ?? "not declared",
    databasePool: process.env.PG_MAX ?? "driver default/record from config",
    network: "not captured by this harness; collect host/container counters separately",
  };
}

async function scrapeMetrics() {
  if (dryRun) return { status: "not_run", values: {} };
  try {
    const response = await fetch(metricsEndpoint, {
      signal: AbortSignal.timeout(Math.max(1_000, intervalMs * 8)),
    });
    const body = await response.text();
    return { status: response.status, values: parsePrometheus(body) };
  } catch (error) {
    return { status: "unavailable", error: String(error?.message ?? error), values: {} };
  }
}

function parsePrometheus(body) {
  const values = {};
  for (const line of body.split("\n")) {
    const match = line.match(
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/,
    );
    if (!match) continue;
    const value = Number(match[3]);
    if (Number.isFinite(value)) values[`${match[1]}${match[2] ?? ""}`] = value;
  }
  return values;
}
