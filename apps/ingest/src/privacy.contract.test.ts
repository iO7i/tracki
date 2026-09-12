import {
  type ClickHouseClient,
  dailyVolume,
  recentEvents,
  recentSessionPaths,
  visitorTimeline,
} from "@tracki/clickhouse";
import type { EventBatch, ProjectRef } from "@tracki/shared";
import { containsPii } from "@tracki/shared";
import { describe, expect, it, vi } from "vitest";
import { inc, observe, prometheus, resetMetrics, setGauge } from "./metrics";
import { normalizeBatch } from "./normalize";

const ref: ProjectRef = { orgId: "org_privacy", projectId: "project_privacy" };

function fakeClickHouse() {
  const queries: Array<{ query: string; query_params?: Record<string, unknown> }> = [];
  const client = {
    query: vi.fn(async (options: { query: string; query_params?: Record<string, unknown> }) => {
      queries.push(options);
      return { json: async () => [] };
    }),
  } as unknown as ClickHouseClient;
  return { client, queries };
}

describe("privacy and tenant isolation contracts", () => {
  it("masks PII before the normalized event can reach storage", () => {
    const receivedAt = Date.now();
    const batch = {
      protocolVersion: 1,
      key: "pk_privacy",
      anonId: "anon_privacy",
      sessionId: "session_privacy",
      sentAt: receivedAt - 1_000,
      events: [
        {
          eventId: "event_privacy",
          type: "pageview",
          ts: receivedAt - 1_000,
          url: "https://example.test/checkout?email=alice@example.com&token=opaque-secret",
          path: "/checkout",
          props: {
            email: "alice@example.com",
            phone: "+966512345678",
            password: "do-not-store",
            nested: { card: "4111 1111 1111 1111" },
            safe: "SAVE10",
          },
        },
      ],
    } as unknown as EventBatch;

    const [event] = normalizeBatch(batch, ref, "Mozilla/5.0", receivedAt);
    expect(event).toBeDefined();
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("+966512345678");
    expect(serialized).not.toContain("do-not-store");
    expect(serialized).not.toContain("4111 1111 1111 1111");
    expect(serialized).toContain("SAVE10");
    const userControlledText = [
      event?.path,
      event?.url,
      event?.referrer,
      event?.props,
      event?.ua,
      event?.app_version,
      event?.device_model,
    ].join("\n");
    expect(containsPii(userControlledText)).toBe(false);
  });

  it("keeps aggregate metrics free of tenant, visitor, and payload values", () => {
    resetMetrics();
    inc("events_accepted_total");
    observe("event_acceptance_latency_ms", 12);
    setGauge("dependency_postgres_up", 1);

    const text = prometheus();
    expect(text).toContain("tracki_events_accepted_total 1");
    expect(text).not.toMatch(
      /org_privacy|project_privacy|anon_privacy|password|alice@example\.com/i,
    );
  });

  it("derives distinct durable event identities for the same client event in different tenants", () => {
    const receivedAt = Date.now();
    const batch = {
      protocolVersion: 1,
      key: "pk_privacy",
      anonId: "anon_shared",
      sessionId: "session_shared",
      sentAt: receivedAt - 1_000,
      events: [
        { eventId: "event_shared", type: "pageview", ts: receivedAt - 1_000, path: "/home" },
      ],
    } as unknown as EventBatch;
    const otherRef: ProjectRef = { orgId: "org_other", projectId: "project_other" };

    const [first] = normalizeBatch(batch, ref, "", receivedAt);
    const [second] = normalizeBatch(batch, otherRef, "", receivedAt);
    expect(first?.event_id).toBeDefined();
    expect(second?.event_id).toBeDefined();
    expect(first?.event_id).not.toBe(second?.event_id);
  });

  it("binds every exercised ClickHouse read to both org and project parameters", async () => {
    const { client, queries } = fakeClickHouse();
    await recentEvents(client, ref.orgId, ref.projectId);
    await recentSessionPaths(client, ref.orgId, ref.projectId, "session_privacy");
    await visitorTimeline(client, ref.orgId, ref.projectId, ["anon_privacy"], null);
    await dailyVolume(client, ref.orgId, ref.projectId);

    expect(queries).toHaveLength(4);
    for (const query of queries) {
      expect(query.query).toMatch(/org_id\s*=\s*\{orgId:String\}/i);
      expect(query.query).toMatch(/project_id\s*=\s*\{projectId:String\}/i);
      expect(query.query).not.toContain(ref.orgId);
      expect(query.query).not.toContain(ref.projectId);
      expect(query.query_params).toMatchObject({ orgId: ref.orgId, projectId: ref.projectId });
    }
  });
});
