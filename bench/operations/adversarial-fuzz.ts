import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { EventBatch, EventInput, EventType, StruggleDetection } from "@tracki/shared";
import { detectBatch } from "../../apps/ingest/src/detector.js";
import { normalizeBatch } from "../../apps/ingest/src/normalize.js";
import { InMemoryStateStore } from "../../apps/ingest/src/state.js";

const args = parseArgs(process.argv.slice(2));
const iterations = positiveInt(args.iterations, 250);
const seed = String(args.seed ?? "tracki-fuzz-v1");
const now = 1_800_000_000_000;
const output = String(
  args.output ??
    `evidence/friction-benchmark/fuzz-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`,
);
const failures: Failure[] = [];

for (let iteration = 0; iteration < iterations; iteration += 1) {
  const events = makeEvents(iteration, seed);
  const ordered = await decisions(events);
  const shuffled = await decisions(shuffle(events, random(iteration + 11, seed)));
  const replay = await decisions([...events, ...events]);
  const expected = stableSignature(ordered);
  for (const [kind, actual] of [
    ["shuffle", shuffled],
    ["duplicate-replay", replay],
  ] as const) {
    if (!sameSignature(stableSignature(actual), expected)) {
      const minimized = await minimize(events, async (candidate) => {
        const base = stableSignature(await decisions(candidate));
        const comparison =
          kind === "shuffle"
            ? stableSignature(await decisions(shuffle(candidate, random(iteration + 11, seed))))
            : stableSignature(await decisions([...candidate, ...candidate]));
        return !sameSignature(base, comparison);
      });
      failures.push({
        iteration,
        kind,
        events: minimized,
        expected,
        actual: stableSignature(actual),
      });
    }
  }
}

const raw = {
  schemaVersion: 1,
  generatorVersion: "adversarial-fuzz-v1",
  seed,
  iterations,
  invariant: "event-time ordering and exact replay produce stable detector decisions",
  failureCount: failures.length,
  failures,
  gitSha: gitSha(),
  generatedAt: new Date().toISOString(),
};
await mkdir(
  output.includes("/") || output.includes("\\") ? output.replace(/[\\/][^\\/]+$/, "") : ".",
  { recursive: true },
);
await writeFile(output, `${JSON.stringify(raw, null, 2)}\n`);
const contents = await readFile(output);
const manifestPath = `${output}.manifest.json`;
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      artifact: output,
      sha256: createHash("sha256").update(contents).digest("hex"),
      bytes: contents.byteLength,
      generatedAt: raw.generatedAt,
    },
    null,
    2,
  )}\n`,
);
// biome-ignore lint/suspicious/noConsole: command-line evidence summary
console.log(
  `# Tracki adversarial fuzz\n\n- Iterations: ${iterations}\n- Failures: ${failures.length}\n- Evidence: ${output}\n- Manifest: ${manifestPath}`,
);
if (failures.length > 0) process.exitCode = 1;

type Failure = {
  iteration: number;
  kind: "shuffle" | "duplicate-replay";
  events: EventInput[];
  expected: string[];
  actual: string[];
};

async function decisions(events: EventInput[]): Promise<StruggleDetection[]> {
  const batch: EventBatch = {
    key: "pk_fuzz",
    anonId: "anon_fuzz",
    sessionId: "session_fuzz",
    sentAt: now,
    events,
  };
  const normalized = normalizeBatch(
    batch,
    { orgId: "org_fuzz", projectId: "project_fuzz" },
    "",
    now + 30 * 60_000,
  );
  const unique = [...new Map(normalized.map((event) => [event.event_id, event])).values()];
  return detectBatch(new InMemoryStateStore(() => now + 30 * 60_000), unique);
}

function makeEvents(iteration: number, seedValue: string): EventInput[] {
  const rng = random(iteration, seedValue);
  const types: EventType[] = [
    "pageview",
    "click",
    "error",
    "otp_fail",
    "payment_fail",
    "screen_view",
    "back_nav",
  ];
  const count = 2 + Math.floor(rng() * 12);
  return Array.from({ length: count }, (_, index) => {
    const type = types[Math.floor(rng() * types.length)] ?? "pageview";
    const props =
      type === "click"
        ? { tag: rng() > 0.4 ? "button" : "div", id: `fuzz-${iteration % 4}` }
        : type === "error"
          ? { message: `synthetic-${iteration % 5}` }
          : type === "otp_fail"
            ? { channel: "sms" }
            : type === "payment_fail"
              ? { method: "mada" }
              : {};
    return {
      eventId: `evt_fuzz_${iteration}_${index}`,
      type,
      ts: now + Math.floor(rng() * 30_000),
      path: ["/home", "/checkout", "/otp", "/payment"][index % 4],
      props,
    };
  });
}

function stableSignature(events: StruggleDetection[]) {
  return events.map((event) => `${event.type}:${event.event_count}:${event.ts}`).sort();
}

function sameSignature(left: string[], right: string[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function minimize(
  events: EventInput[],
  stillFails: (candidate: EventInput[]) => Promise<boolean>,
) {
  let candidate = [...events];
  let changed = true;
  while (changed && candidate.length > 1) {
    changed = false;
    for (let index = 0; index < candidate.length; index += 1) {
      const next = candidate.slice(0, index).concat(candidate.slice(index + 1));
      if (next.length > 0 && (await stillFails(next))) {
        candidate = next;
        changed = true;
        break;
      }
    }
  }
  return candidate;
}

function shuffle<T>(values: T[], rng: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const current = result[index];
    const target = result[swap];
    if (current === undefined || target === undefined) continue;
    result[index] = target;
    result[swap] = current;
  }
  return result;
}

function random(offset: number, value: string) {
  let state = 0x811c9dc5 ^ offset;
  for (const char of value) state = Math.imul(state ^ char.charCodeAt(0), 0x01000193);
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function parseArgs(values: string[]) {
  const result: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith("--")) continue;
    const [name, inline] = value.slice(2).split("=", 2);
    result[name] = inline ?? values[index + 1] ?? "";
    if (inline === undefined) index += 1;
  }
  return result;
}

function positiveInt(value: string | undefined, fallback: number) {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}
