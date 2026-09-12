import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { EventBatch, EventType } from "@tracki/shared";
import { detectBatch } from "../../apps/ingest/src/detector.js";
import { normalizeBatch } from "../../apps/ingest/src/normalize.js";
import { InMemoryStateStore } from "../../apps/ingest/src/state.js";

const DATASET_VERSION = "friction-v1";
const SET_SEEDS = { dev: 101, tune: 202, holdout: 303 };
const requestedSet =
  process.argv.find((value) => value.startsWith("--set="))?.split("=", 2)[1] ?? "holdout";
const runSet = (requestedSet in SET_SEEDS ? requestedSet : "holdout") as keyof typeof SET_SEEDS;
const output =
  process.argv.find((value) => value.startsWith("--output="))?.split("=", 2)[1] ??
  `evidence/friction-benchmark/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const now = 1_800_000_000_000;

const scenarioSpecs = [
  positive("payment", "repeated_payment_failure", [
    event("payment_fail", 0, { method: "mada" }),
    event("payment_fail", 1_000, { method: "mada" }),
  ]),
  negative("payment", "one payment failure followed by success", [
    event("payment_fail", 0, { method: "mada" }),
    event("payment_complete", 1_000, { method: "mada" }),
  ]),
  positive("otp", "otp failure loop", [event("otp_fail", 0), event("otp_fail", 1_000)]),
  negative("otp", "one OTP typo followed by success", [
    event("otp_fail", 0),
    event("otp_success", 2_000),
  ]),
  positive("rage", "repeated click burst", [
    event("click", 0, { tag: "button", id: "continue", class: "primary" }),
    event("click", 300, { tag: "button", id: "continue", class: "primary" }),
    event("click", 600, { tag: "button", id: "continue", class: "primary" }),
  ]),
  negative("rage", "ordinary double click", [
    event("click", 0, { tag: "button", id: "continue", class: "primary" }),
    event("click", 450, { tag: "button", id: "continue", class: "primary" }),
  ]),
  positive(
    "navigation",
    "navigation loop",
    Array.from({ length: 6 }, (_, i) => event("pageview", i * 500, {}, `/step-${i % 2}`)),
  ),
  negative(
    "navigation",
    "rapid successful navigation",
    Array.from({ length: 6 }, (_, i) =>
      event("pageview", i * 500, { outcome: "success" }, `/step-${i}`),
    ),
  ),
  positive("onboarding", "explicit onboarding abandonment", [
    event("flow_start", 0, { flow: "onboarding" }, "/onboarding"),
    event("flow_abandon", 10_000, { flow: "onboarding" }, "/onboarding/profile"),
  ]),
  negative("onboarding", "slow onboarding completion", [
    event("flow_start", 0, { flow: "onboarding" }, "/onboarding"),
    event("flow_complete", 20 * 60_000, { flow: "onboarding" }, "/onboarding/done"),
  ]),
  negative("lifecycle", "background and foreground without friction", [
    event("app_background", 0, { durationMs: 5_000 }),
    event("app_foreground", 10_000, { launch: "warm" }),
  ]),
];

const scenarios = await Promise.all(
  scenarioSpecs.flatMap((spec, index) => [
    evaluate({
      ...spec,
      id: `${spec.family}-${index}-en`,
      locale: "en",
      seed: SET_SEEDS[runSet] + index,
    }),
    evaluate({
      ...spec,
      id: `${spec.family}-${index}-ar`,
      locale: "ar",
      seed: SET_SEEDS[runSet] + index,
    }),
  ]),
);
const summary = summarize(scenarios);
const raw = {
  schemaVersion: 1,
  datasetVersion: DATASET_VERSION,
  generatorVersion: "friction-generator-v1",
  set: runSet,
  seed: SET_SEEDS[runSet],
  generatedAt: new Date().toISOString(),
  thresholds: {
    paymentFailureWindowMs: 600_000,
    otpFailureWindowMs: 300_000,
    rageClickWindowMs: 3_000,
    navigationWindowMs: 30_000,
    onboardingSemantics: "explicit flow_abandon only",
  },
  interventionSemantics:
    "intervention rates are detector-trigger proxies; this benchmark does not execute user-visible side effects",
  scenarios,
  summary,
};
const report = renderReport(raw);
await mkdir(output, { recursive: true });
await writeFile(`${output}/raw.json`, `${JSON.stringify(raw, null, 2)}\n`);
await writeFile(`${output}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(`${output}/report.md`, report);
const manifest = {
  schemaVersion: 1,
  datasetVersion: DATASET_VERSION,
  generatorVersion: raw.generatorVersion,
  set: runSet,
  seed: raw.seed,
  gitSha: gitSha(),
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

function event(
  type: EventType,
  offsetMs: number,
  props: Record<string, unknown> = {},
  path = "/checkout",
) {
  return { eventId: `evt_friction_${type}_${offsetMs}`, type, ts: now + offsetMs, path, props };
}

function positive(family: string, name: string, events: ReturnType<typeof event>[]) {
  return { family, name, label: "positive", expectedType: expectedType(family), events };
}

function negative(family: string, name: string, events: ReturnType<typeof event>[]) {
  return { family, name, label: "negative", expectedType: expectedType(family), events };
}

function expectedType(family: string): string {
  return (
    (
      {
        payment: "repeated_payment_failure",
        otp: "otp_failure_loop",
        rage: "rage_click",
        navigation: "thrashing",
        onboarding: "onboarding_abandonment",
        lifecycle: "app_restart_loop",
      } as Record<string, string>
    )[family] ?? family
  );
}

async function evaluate(
  spec: (typeof scenarioSpecs)[number] & { id: string; locale: string; seed: number },
) {
  const input = {
    key: "pk_friction_benchmark",
    anonId: `anon_${spec.id}`,
    sessionId: `session_${spec.id}`,
    sentAt: now,
    events: spec.events.map((item) => ({ ...item, props: { ...item.props, locale: spec.locale } })),
  } as EventBatch;
  const stored = normalizeBatch(
    input,
    { orgId: "org_friction", projectId: "project_friction" },
    "",
    now + 30 * 60_000,
  );
  const detections = await detectBatch(new InMemoryStateStore(() => now + 30 * 60_000), stored);
  const matching = detections.filter((d) => d.type === spec.expectedType);
  return {
    id: spec.id,
    family: spec.family,
    name: spec.name,
    label: spec.label,
    locale: spec.locale,
    expectedType: spec.expectedType,
    detected: matching.length > 0,
    detectedTypes: detections.map((d) => d.type),
    detectionLatencyMs: matching[0] ? matching[0].ts - Math.min(...stored.map((e) => e.ts)) : null,
    eventCount: stored.length,
    seed: spec.seed,
  };
}

function summarize(results: Awaited<ReturnType<typeof evaluate>>[]) {
  const families = [...new Set(results.map((r) => r.family))].map((family) =>
    metricsFor(
      results.filter((r) => r.family === family),
      family,
    ),
  );
  return {
    overall: metricsFor(results, "overall"),
    byFamily: families,
    macroAverage: macroAverage(families),
    parity: parity(results),
  };
}

function metricsFor(results: Awaited<ReturnType<typeof evaluate>>[], family: string) {
  const tp = results.filter((r) => r.label === "positive" && r.detected).length;
  const fp = results.filter((r) => r.label === "negative" && r.detected).length;
  const fn = results.filter((r) => r.label === "positive" && !r.detected).length;
  const tn = results.filter((r) => r.label === "negative" && !r.detected).length;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const latency = results
    .map((r) => r.detectionLatencyMs)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  return {
    family,
    scenarioCount: results.length,
    positiveCount: tp + fn,
    negativeCount: tn + fp,
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    precision,
    recall,
    f1,
    falsePositiveRate: fp + tn === 0 ? 0 : fp / (fp + tn),
    interventionTriggerRate:
      results.length === 0
        ? 0
        : results.filter((result) => result.detected).length / results.length,
    falseInterventionRate: fp + tn === 0 ? 0 : fp / (fp + tn),
    detectionLatencyMs: { p50: percentile(latency, 0.5), p95: percentile(latency, 0.95) },
  };
}

function macroAverage(families: ReturnType<typeof metricsFor>[]) {
  const average = (key: "precision" | "recall" | "f1" | "falsePositiveRate") =>
    families.length === 0
      ? 0
      : families.reduce((sum, family) => sum + family[key], 0) / families.length;
  return {
    precision: average("precision"),
    recall: average("recall"),
    f1: average("f1"),
    falsePositiveRate: average("falsePositiveRate"),
  };
}

function parity(results: Awaited<ReturnType<typeof evaluate>>[]) {
  const pairs = new Map<string, Awaited<ReturnType<typeof evaluate>>[]>();
  for (const result of results) {
    const base = result.id.replace(/-(ar|en)$/, "");
    pairs.set(base, [...(pairs.get(base) ?? []), result]);
  }
  const compared = [...pairs.values()].filter((pair) => pair.length === 2);
  const mismatches = compared.filter((pair) => pair[0]?.detected !== pair[1]?.detected).length;
  return {
    pairedScenarios: compared.length,
    decisionMismatches: mismatches,
    parityRate: compared.length === 0 ? 1 : 1 - mismatches / compared.length,
  };
}

function renderReport(result: typeof raw) {
  const overall = result.summary.overall;
  const lines = [
    "# Tracki friction benchmark",
    "",
    `- Dataset: \`${result.datasetVersion}\` / generator \`${result.generatorVersion}\``,
    `- Evaluation set: **${result.set}** (seed ${result.seed})`,
    `- Scenarios: ${overall.scenarioCount} (${overall.positiveCount} positive, ${overall.negativeCount} negative)`,
    "",
    "## Overall holdout metrics",
    "",
    `TP ${overall.truePositives} · FP ${overall.falsePositives} · TN ${overall.trueNegatives} · FN ${overall.falseNegatives}`,
    `Precision ${(overall.precision * 100).toFixed(1)}% · Recall ${(overall.recall * 100).toFixed(1)}% · F1 ${(overall.f1 * 100).toFixed(1)}% · FPR ${(overall.falsePositiveRate * 100).toFixed(1)}%`,
    `Intervention trigger rate ${(overall.interventionTriggerRate * 100).toFixed(1)}% · false intervention rate ${(overall.falseInterventionRate * 100).toFixed(1)}%`,
    `Macro precision ${(result.summary.macroAverage.precision * 100).toFixed(1)}% · macro recall ${(result.summary.macroAverage.recall * 100).toFixed(1)}% · macro F1 ${(result.summary.macroAverage.f1 * 100).toFixed(1)}% · macro FPR ${(result.summary.macroAverage.falsePositiveRate * 100).toFixed(1)}%`,
    `Event-time detection latency p50 ${overall.detectionLatencyMs.p50}ms · p95 ${overall.detectionLatencyMs.p95}ms`,
    "Intervention rates are detector-trigger proxies; no user-visible side effect is executed by this benchmark.",
    "",
    "## Per-family metrics",
    "",
    "| Family | Scenarios | Precision | Recall | F1 | FPR |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const family of result.summary.byFamily) {
    lines.push(
      `| ${family.family} | ${family.scenarioCount} | ${(family.precision * 100).toFixed(1)}% | ${(family.recall * 100).toFixed(1)}% | ${(family.f1 * 100).toFixed(1)}% | ${(family.falsePositiveRate * 100).toFixed(1)}% |`,
    );
  }
  lines.push(
    "",
    "## Arabic/English parity",
    "",
    `${result.summary.parity.pairedScenarios} paired scenarios; ${result.summary.parity.decisionMismatches} decision mismatches; parity ${(result.summary.parity.parityRate * 100).toFixed(1)}%. Locale is treated as metadata for these language-independent detectors.`,
    "",
    "The benchmark includes hard negatives intentionally. In particular, rapid successful navigation is not silently relabeled as friction; any resulting false positive remains visible in the report.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function percentile(values: number[], p: number) {
  return values.length === 0
    ? 0
    : (values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))] ?? 0);
}

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}
