import { afterEach, describe, expect, it } from "vitest";
import { createTracki } from "./client";
import { Identity } from "./identity";
import { EventQueue } from "./queue";
import { collectionBudget, deliveryCategory, utf8Bytes } from "./reliability";
import type { Batch, KeyValueStorage, Transport } from "./types";
const queues: EventQueue[] = [];
afterEach(() => {
  for (const queue of queues.splice(0)) queue.dispose();
});
async function fixture(
  options: {
    budget?: Parameters<typeof collectionBudget>[0];
    post?: Transport["post"];
    stored?: string;
  } = {},
) {
  let time = 1_800_000_000_000;
  const data = new Map<string, string>();
  if (options.stored) data.set("test:queue", options.stored);
  const storage: KeyValueStorage = {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
  };
  const now = () => time;
  let seq = 0;
  const identity = new Identity(storage, now, (prefix) => `${prefix}_${++seq}`, "test");
  await identity.hydrate();
  let scope = "a".repeat(64);
  const sent: Batch[] = [];
  const queue = new EventQueue(
    "pk_test",
    "https://ingest.test/v1/events",
    identity,
    { platform: "ios" },
    {
      get: async () => ({}),
      post:
        options.post ??
        (async (_, value) => {
          const batch = value as Batch;
          sent.push(batch);
          return { acceptedClientIds: batch.events.map((event) => event.eventId) };
        }),
    },
    now,
    {
      storage,
      storageNamespace: "test",
      scopeTag: () => scope,
      budget: options.budget,
      random: () => 0.9,
    },
  );
  queues.push(queue);
  await queue.hydrate();
  return {
    queue,
    identity,
    sent,
    data,
    storage,
    now,
    advance: (ms: number) => {
      time += ms;
    },
    switchScope: (next: string) => {
      scope = next;
    },
  };
}
describe("bounded native reliability", () => {
  it("counts sampled routine success but retains failures and unusual latency", async () => {
    const f = await fixture({ budget: { routineSuccessSampleRate: 0 } });
    for (const [statusCode, durationMs] of [
      [200, 2],
      [500, 2],
      [200, 8000],
    ])
      f.queue.enqueue({
        type: "track",
        ts: f.now(),
        path: "/api/orders",
        props: { name: "cco_response", statusCode, durationMs },
      });
    await f.queue.flush();
    expect(f.sent.flatMap((batch) => batch.events)).toHaveLength(2);
    expect(f.queue.health()).toMatchObject({
      observed: 3,
      sampledOut: 1,
      accepted: 2,
      queueDepth: 0,
    });
    expect(f.sent[0]?.events.every((event) => event.sampleRate === 1)).toBe(true);
  });
  it("drops routine success before earlier failure under capacity pressure", async () => {
    const f = await fixture({ budget: { maxQueuedEvents: 2 } });
    f.queue.enqueue({ type: "error", ts: f.now(), props: { code: "JS_FATAL" } });
    f.queue.enqueue({
      type: "track",
      ts: f.now(),
      props: { name: "cco_response", statusCode: 200, durationMs: 2 },
    });
    f.queue.enqueue({ type: "error", ts: f.now(), props: { code: "NETWORK_FAILURE" } });
    await f.queue.flush();
    expect(f.sent.flatMap((batch) => batch.events).map((event) => event.type)).toEqual([
      "error",
      "error",
    ]);
    expect(f.queue.health().droppedCapacity).toBe(1);
  });
  it("retains retryable network evidence durably with fixed identity and ids", async () => {
    let fail = true;
    const sent: Batch[] = [];
    const f = await fixture({
      post: async (_, value) => {
        const batch = value as Batch;
        sent.push(batch);
        if (fail) throw new Error("offline");
        return { acceptedClientIds: batch.events.map((event) => event.eventId) };
      },
    });
    f.identity.setUserId("principal_a");
    f.queue.enqueue({ type: "error", ts: f.now(), props: { code: "JS_ERROR" } });
    await f.queue.flush();
    f.identity.setUserId("principal_b");
    expect(f.queue.health()).toMatchObject({
      queueDepth: 1,
      retryingCount: 1,
      lastResponseCategory: "network_unavailable",
    });
    expect(JSON.parse(f.data.get("test:queue") ?? "null").buffer).toHaveLength(1);
    fail = false;
    await f.queue.flush();
    expect(sent[1]?.userId).toBe("principal_a");
    expect(sent[1]?.events[0]?.eventId).toBe(sent[0]?.events[0]?.eventId);
    expect(f.queue.size).toBe(0);
  });
  it("does not retry permanent unsupported schemas forever", async () => {
    const f = await fixture({
      post: async () => {
        throw { status: 422 };
      },
    });
    f.queue.enqueue({ type: "error", ts: f.now(), props: { code: "JS_ERROR" } });
    await f.queue.flush();
    expect(f.queue.health()).toMatchObject({
      queueDepth: 0,
      rejected: 1,
      unsupportedSchema: 1,
      lastResponseCategory: "unsupported_schema",
    });
  });
  it("does not remove evidence for an invented acknowledgment", async () => {
    const f = await fixture({ post: async () => ({ acceptedClientIds: ["evt_not_sent"] }) });
    f.queue.enqueue({ type: "error", ts: f.now(), props: { code: "JS_ERROR" } });
    await f.queue.flush();
    expect(f.queue.health()).toMatchObject({
      queueDepth: 1,
      accepted: 0,
      lastResponseCategory: "invalid_acknowledgment",
    });
  });
  it("expires evidence with a durable reason", async () => {
    const f = await fixture({ budget: { eventTtlMs: 1000 } });
    f.queue.enqueue({ type: "error", ts: f.now(), props: { code: "JS_ERROR" } });
    f.advance(1001);
    await f.queue.flush();
    expect(f.queue.health().droppedExpired).toBe(1);
    expect(f.sent).toHaveLength(0);
  });
  it("purges tenant counters, reporter and pending events on scope change/reset", async () => {
    const f = await fixture();
    const reporter = f.queue.health().reporterId;
    f.queue.enqueue({ type: "error", ts: f.now(), props: { code: "JS_ERROR" } });
    f.switchScope("b".repeat(64));
    await f.queue.reconcileScope();
    expect(f.queue.health()).toMatchObject({ observed: 0, queueDepth: 0 });
    expect(f.queue.health().reporterId).not.toBe(reporter);
    const next = f.queue.health().reporterId;
    await f.queue.clear();
    expect(f.queue.health().reporterId).not.toBe(next);
  });
  it("retains previous schema identity rather than relabeling old batches", async () => {
    const old: Batch = {
      key: "pk_test",
      anonId: "anon_old",
      sessionId: "sess_old",
      scopeTag: "a".repeat(64),
      sentAt: 1_800_000_000_000,
      device: { platform: "ios" },
      events: [
        { eventId: "evt_old", type: "error", ts: 1_800_000_000_000, props: { code: "JS_ERROR" } },
      ],
    };
    const f = await fixture({ stored: JSON.stringify([{ batch: old, sealed: true }]) });
    await f.queue.flush();
    expect(f.sent[0]?.protocol).toBeUndefined();
    expect(f.sent[0]?.anonId).toBe("anon_old");
  });
  it("reports storage failure and never sends an unpersisted batch", async () => {
    const f = await fixture();
    f.storage.set = async () => {
      throw new Error("disk unavailable");
    };
    f.queue.enqueue({ type: "error", ts: f.now(), props: { code: "JS_ERROR" } });
    await f.queue.flush();
    expect(f.sent).toHaveLength(0);
    expect(f.queue.health().storageFailures).toBeGreaterThan(0);
  });
  it("partitions custom namespaces between environments", async () => {
    const storage: KeyValueStorage = { get: async () => null, set: async () => {} };
    const a = await createTracki({
      key: "pk_test",
      endpoint: "https://ingest.test",
      device: { platform: "ios" },
      storage,
      storageNamespace: "same",
      environment: "staging",
    });
    const b = await createTracki({
      key: "pk_test",
      endpoint: "https://ingest.test",
      device: { platform: "ios" },
      storage,
      storageNamespace: "same",
      environment: "production",
    });
    expect(a.anonId()).not.toBe(b.anonId());
    a.dispose();
    b.dispose();
  });
  it("counts UTF-8 bytes and rejects budgets above safe caps", () => {
    expect(utf8Bytes("ع😀")).toBe(6);
    expect(() => collectionBudget({ maxQueuedBytes: 1e9 })).toThrow();
    expect(deliveryCategory({ status: 429 })).toBe("rate_limited");
    expect(deliveryCategory({ status: 503 })).toBe("retryable_server_failure");
  });
  it("enforces the batch byte limit including protocol and health metadata", async () => {
    const f = await fixture({ budget: { batchByteLimit: 1500, batchSize: 50 } });
    for (let i = 0; i < 6; i++)
      f.queue.enqueue({
        type: "error",
        ts: f.now(),
        props: { code: "JS_ERROR" },
        fingerprint: "a".repeat(64),
      });
    await f.queue.flush();
    expect(f.sent.length).toBeGreaterThan(0);
    expect(f.sent.every((batch) => utf8Bytes(JSON.stringify(batch)) <= 1500)).toBe(true);
  });
  it("does not restore old tenant counters when an acknowledgment write fails during reset", async () => {
    const f = await fixture();
    const set = f.storage.set;
    let failAck: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.storage.set = async (key, value) => {
      const document = key.endsWith(":queue") ? JSON.parse(value) : {};
      if (document.health?.accepted === 1) {
        entered?.();
        await new Promise<void>((_, reject) => {
          failAck = () => reject(new Error("fixture disk failure"));
        });
      } else await set(key, value);
    };
    f.queue.enqueue({ type: "error", ts: f.now(), props: { code: "JS_ERROR" } });
    const flush = f.queue.flush();
    await waiting;
    const clear = f.queue.clear();
    failAck?.();
    await Promise.all([flush, clear]);
    expect(f.queue.health()).toMatchObject({
      observed: 0,
      accepted: 0,
      queueDepth: 0,
      storageFailures: 0,
    });
    expect(JSON.parse(f.data.get("test:queue") ?? "null").health.accepted).toBe(0);
  });
  it("rotates the current session on build/update change without relabeling the durable old queue", async () => {
    const data = new Map<string, string>();
    const storage: KeyValueStorage = {
      get: async (key) => data.get(key) ?? null,
      set: async (key, value) => {
        data.set(key, value);
      },
    };
    const common = {
      key: "pk_build",
      endpoint: "https://ingest.test",
      device: { platform: "ios" as const },
      storage,
      capturePolicy: { diagnostics: true, activity: false },
      scopeTag: "a".repeat(64),
    };
    const first = await createTracki({ ...common, build: { buildId: "one" } });
    first.error("JS_ERROR");
    const session = first.sessionId();
    await first.refreshDeliveryHealth();
    first.dispose();
    const sent: Batch[] = [];
    const second = await createTracki({
      ...common,
      build: { buildId: "two" },
      transport: {
        get: async () => ({}),
        post: async (_, value) => {
          const batch = value as Batch;
          sent.push(batch);
          return { acceptedClientIds: batch.events.map((event) => event.eventId) };
        },
      },
    });
    expect(second.sessionId()).not.toBe(session);
    second.error("JS_ERROR");
    await second.flush();
    second.dispose();
    expect(sent[0]).toMatchObject({ sessionId: session, build: { buildId: "one" } });
    expect(sent[1]?.build?.buildId).toBe("two");
    expect(sent[1]?.sessionId).not.toBe(session);
  });
});
