import { randomUUID } from "node:crypto";
import { createClickHouse, insertEvents, insertStruggles } from "@tracki/clickhouse";
import { migrate } from "@tracki/clickhouse/migrate";
import type { EventBatch, StoredEvent } from "@tracki/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptEvents, ensureInbox } from "../src/inbox";
import { normalizeBatch } from "../src/normalize";
import { closePg, pg } from "../src/pg";
import { closeRedis, redis } from "../src/redis";
import { buildServer } from "../src/server";
import { type WorkerIO, processOne } from "../src/worker";

// No substitute dependencies: this suite requires real PostgreSQL, Redis and ClickHouse.
const sql = pg();
const ch = createClickHouse();
const app = buildServer();
const project = randomUUID();
const org = randomUUID();
const key = `pk_${randomUUID()}`;
const ref = { projectId: project, orgId: org };
const io: WorkerIO = {
  events: (e) => insertEvents(ch, e),
  struggles: (s) => insertStruggles(ch, s),
};
let counter = 0;
function batch(
  offsets = [0, 4000, 8000],
  type = "click",
  anonId = `anon_${++counter}`,
): EventBatch {
  const now = Date.now();
  return {
    key,
    anonId,
    sessionId: "same_session",
    sentAt: now,
    events: offsets.map((offset, i) => ({
      eventId: `${anonId}_${i}`,
      type: type as "click",
      ts: now - 8000 + offset,
      props: { tag: "button", id: "buy" },
      path: "/checkout",
    })),
  };
}
async function count(table: "events" | "struggles", anon: string): Promise<number> {
  const result = await ch.query({
    query: `SELECT count() AS n FROM ${table} WHERE project_id={project:String} AND anon_id={anon:String}`,
    query_params: { project, anon },
    format: "JSONEachRow",
  });
  return Number((await result.json<{ n: string }>())[0]?.n);
}
async function drain() {
  for (let i = 0; i < 100; i++) {
    if (!(await processOne(sql, io))) break;
  }
}
beforeAll(async () => {
  await sql`SELECT 1`;
  await redis().ping();
  await migrate();
  await ensureInbox(sql);
  // Cache seeds avoid unrelated account setup, while /v1/events still exercises real resolution/storage.
  await redis().set(`key:${key}`, `${project}|${org}`, "EX", 3600);
});
afterAll(async () => {
  await app.close();
  await ch.close();
  await closePg();
  await closeRedis();
});

describe("real ingestion and worker contract", () => {
  it("HTTP normalization preserves event spacing and redacts encoded secrets", async () => {
    const input = batch();
    for (const e of input.events) {
      e.url = "https://example.test/?password=demo-password&email=person%40example.test";
      e.props = { ...e.props, Authorization: "Bearer exampleOpaqueToken" };
    }
    const response = await app.inject({ method: "POST", url: "/v1/events", payload: input });
    expect(response.statusCode).toBe(202);
    await drain();
    expect(await count("events", input.anonId)).toBe(3);
    expect(await count("struggles", input.anonId)).toBe(0);
    const result = await ch.query({
      query: "SELECT url,props FROM events WHERE project_id={p:String} AND anon_id={a:String}",
      query_params: { p: project, a: input.anonId },
      format: "JSONEachRow",
    });
    expect(JSON.stringify(await result.json())).not.toMatch(
      /demo-password|person%40|exampleOpaqueToken/,
    );
  });
  it("concurrent full and partial retries produce one logical event and detection", async () => {
    const input = batch([7000, 7500, 8000]);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({ method: "POST", url: "/v1/events", payload: input }),
      ),
    );
    expect(responses.every((r) => r.statusCode === 202)).toBe(true);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/events",
          payload: { ...input, sentAt: Date.now(), events: input.events.slice(1) },
        })
      ).statusCode,
    ).toBe(202);
    await drain();
    expect(await count("events", input.anonId)).toBe(3);
    expect(await count("struggles", input.anonId)).toBe(1);
  });
  it("multiple workers cannot acknowledge another worker's in-flight record", async () => {
    const input = batch([8000]);
    await acceptEvents(normalizeBatch(input, ref, "", Date.now()), sql);
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const ready = new Promise<void>((r) => {
      entered = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const first = processOne(sql, {
      ...io,
      beforeAck: async () => {
        entered();
        await gate;
      },
    });
    await ready;
    expect(await processOne(sql, io)).toBe(false);
    const pending =
      await sql`SELECT completed_at FROM telemetry_inbox WHERE project_id=${project} AND event_id=${normalizeBatch(input, ref, "", Date.now())[0]?.event_id ?? ""}`;
    expect(pending[0]?.completed_at).toBeNull();
    release();
    expect(await first).toBe(true);
    expect(await count("events", input.anonId)).toBe(1);
  });
  it("failure before ACK rolls back detector state and safely retries persisted rows", async () => {
    const input = batch([7000, 7500, 8000]);
    await acceptEvents(normalizeBatch(input, ref, "", Date.now()), sql);
    expect(await processOne(sql, io)).toBe(true);
    expect(await processOne(sql, io)).toBe(true);
    expect(
      await processOne(sql, {
        ...io,
        beforeAck: async () => {
          throw new Error("injected crash before ack");
        },
      }),
    ).toBe(false);
    await sql`UPDATE telemetry_inbox SET available_at=now() WHERE project_id=${project} AND completed_at IS NULL`;
    await drain();
    expect(await count("events", input.anonId)).toBe(3);
    expect(await count("struggles", input.anonId)).toBe(1);
  });
  it("detect-write failure is retried instead of silently discarded", async () => {
    const input = batch([7000, 7500, 8000]);
    await acceptEvents(normalizeBatch(input, ref, "", Date.now()), sql);
    await processOne(sql, io);
    await processOne(sql, io);
    expect(
      await processOne(sql, {
        ...io,
        struggles: async () => {
          throw new Error("injected unavailable sink");
        },
      }),
    ).toBe(false);
    await sql`UPDATE telemetry_inbox SET available_at=now() WHERE project_id=${project} AND completed_at IS NULL`;
    await drain();
    expect(await count("struggles", input.anonId)).toBe(1);
  });
  it("terminated worker connection releases ownership for another worker", async () => {
    const input = batch([8000]);
    await acceptEvents(normalizeBatch(input, ref, "", Date.now()), sql);
    let report: (pid: number) => void = () => {};
    const ready = new Promise<number>((r) => {
      report = r;
    });
    const first = processOne(sql, {
      ...io,
      beforeAck: async (tx) => {
        const rows = await tx`SELECT pg_backend_pid() AS pid`;
        report(Number(rows[0]?.pid));
        await tx`SELECT pg_sleep(30)`;
      },
    });
    const pid = await ready;
    await sql`SELECT pg_terminate_backend(${pid})`;
    expect(await first).toBe(false);
    await sql`UPDATE telemetry_inbox SET available_at=now() WHERE project_id=${project} AND completed_at IS NULL`;
    expect(await processOne(sql, io)).toBe(true);
    expect(await count("events", input.anonId)).toBe(1);
  });
  it("same session and client event IDs in another project remain isolated", async () => {
    const otherProject = randomUUID();
    const otherKey = `pk_${randomUUID()}`;
    await redis().set(`key:${otherKey}`, `${otherProject}|${org}`, "EX", 3600);
    const input = batch([8000]);
    await app.inject({ method: "POST", url: "/v1/events", payload: input });
    await app.inject({ method: "POST", url: "/v1/events", payload: { ...input, key: otherKey } });
    await drain();
    const rows =
      await sql`SELECT project_id,event_id FROM telemetry_inbox WHERE project_id IN (${project},${otherProject}) AND event_id IN (${normalizeBatch(input, ref, "", Date.now())[0]?.event_id ?? ""},${normalizeBatch(input, { projectId: otherProject, orgId: org }, "", Date.now())[0]?.event_id ?? ""})`;
    expect(rows.length).toBe(2);
    expect(rows[0]?.event_id).not.toBe(rows[1]?.event_id);
  });
  it("rejects invalid session IDs and timestamps through the actual HTTP route", async () => {
    const input = batch();
    for (const sessionId of ["bad:session", "x".repeat(65), "a\nb"]) {
      expect(
        (await app.inject({ method: "POST", url: "/v1/events", payload: { ...input, sessionId } }))
          .statusCode,
      ).toBe(400);
    }
    const first = input.events[0];
    if (!first) throw new Error("missing fixture");
    first.ts = Date.now() + 600_000;
    expect(
      (await app.inject({ method: "POST", url: "/v1/events", payload: input })).statusCode,
    ).toBe(400);
  });
  it("late arrivals are stored but do not retroactively change detectors", async () => {
    const input = batch([8000]);
    await acceptEvents(normalizeBatch(input, ref, "", Date.now()), sql);
    await drain();
    const first = input.events[0];
    if (!first) throw new Error("missing fixture");
    input.events = [{ ...first, eventId: "late_1", ts: first.ts - 1000 }];
    await acceptEvents(normalizeBatch(input, ref, "", Date.now()), sql);
    await drain();
    expect(await count("events", input.anonId)).toBe(2);
    expect(await count("struggles", input.anonId)).toBe(0);
  });
  it("poison records stop retrying after five failures", async () => {
    const input = batch([8000]);
    const events = normalizeBatch(input, ref, "", Date.now());
    await acceptEvents(events, sql);
    for (let i = 0; i < 5; i++) {
      await processOne(sql, {
        ...io,
        events: async () => {
          throw new Error("poison");
        },
      });
      await sql`UPDATE telemetry_inbox SET available_at=now() WHERE project_id=${project} AND completed_at IS NULL`;
    }
    const rows =
      await sql`SELECT attempts,dead_at FROM telemetry_inbox WHERE project_id=${project} AND event_id=${events[0]?.event_id ?? ""}`;
    expect(rows[0]?.attempts).toBe(5);
    expect(rows[0]?.dead_at).not.toBeNull();
    expect(await processOne(sql, io)).toBe(false);
  });
  it("migration is repeatable and retains previously inserted data and TTL", async () => {
    const input = batch([8000]);
    await acceptEvents(normalizeBatch(input, ref, "", Date.now()), sql);
    await drain();
    await migrate();
    expect(await count("events", input.anonId)).toBe(1);
    const result = await ch.query({ query: "SHOW CREATE TABLE events", format: "JSONEachRow" });
    expect(JSON.stringify(await result.json())).toContain("TTL");
  });
});
