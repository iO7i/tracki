import type { StoredEvent } from "@tracki/shared";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { type CcoEvent, safeRoute, sessionRef } from "./contract";
import { projectBehavior } from "./projection";
import { registerCcoRoutes } from "./routes";
import { type Binding, type CcoStore, parseBinding } from "./store";
const now = Date.now();
const scope = {
  orgId: "org",
  projectId: "project",
  appKey: "seo",
  environment: "test",
  producerKey: "p".repeat(40),
};
function stored(): StoredEvent {
  return {
    org_id: "org",
    project_id: "project",
    anon_id: "anon",
    user_id: "pretend_account",
    session_id: "session",
    event_id: "event",
    type: "pageview",
    path: "/settings?token=secret",
    url: "",
    referrer: "",
    props: JSON.stringify({
      accountId: "forged",
      authority: "server-reported",
      password: "secret",
    }),
    ua: "",
    platform: "web",
    app_version: "",
    device_model: "",
    ts: now,
    received_at: now,
  };
}
describe("CCO privacy and authority", () => {
  it("redacts readable customer slugs", () => {
    expect(safeRoute("/products/customer-secret?token=secret#private")).toBe("/products/:id");
    expect(safeRoute("/account/Hosam")).toBe("/account/:id");
  });
  it("ignores browser account and authority claims", () => {
    const result = projectBehavior(stored(), scope);
    expect(result.accountId).toBeNull();
    expect(result.authority).toBe("observed");
    expect(JSON.stringify(result)).not.toContain("forged");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("handles opaque or masked app versions and null properties without losing telemetry", () =>
    expect(() =>
      projectBehavior({ ...stored(), props: "null", app_version: "[redacted]" }, scope),
    ).not.toThrow());
  it("scopes analytics session hashes to project and organization", () => {
    expect(sessionRef("o", "p", "a", "s")).not.toBe(sessionRef("o", "q", "a", "s"));
    expect(sessionRef("o", "p", "a", "s")).not.toBe(sessionRef("x", "p", "a", "s"));
  });
  it("requires explicit binding times so retries are stable", () => {
    expect(() =>
      parseBinding({ accountId: "a", anonId: "a", sessionId: "s" }, scope, now),
    ).toThrow();
    const input = {
      accountId: "a",
      anonId: "a",
      sessionId: "s",
      validFrom: now,
      expiresAt: now + 60000,
    };
    expect(parseBinding(input, scope, now)).toEqual(parseBinding(input, scope, now + 1000));
  });
  it("does not report payment success as authoritative business success", () =>
    expect(projectBehavior({ ...stored(), type: "payment_complete" }, scope).outcome).toBe(
      "observed",
    ));
});
describe("CCO route boundaries", () => {
  async function setup() {
    let accepted: CcoEvent[] = [];
    let bound: Binding | null = null;
    const store: CcoStore = {
      async append(events) {
        accepted = events;
      },
      async bind(b) {
        bound = b;
      },
      async snapshot() {
        return {
          version: 1,
          generatedAt: now,
          windowStart: now - 1000,
          events: accepted,
          truncated: false,
          coverage: {
            status: "available",
            reason: "test",
            lastReceivedAt: null,
            pending: 0,
            deadLetters: 0,
            oldestPendingAt: null,
          },
        };
      },
    };
    const app = Fastify();
    registerCcoRoutes(app, store, { readKey: "r".repeat(40), projects: [scope] });
    await app.ready();
    return { app, accepted: () => accepted, bound: () => bound };
  }
  it("requires the reader key and excludes producer keys from reading", async () => {
    const { app } = await setup();
    try {
      for (const key of ["", "p".repeat(40), "wrong"])
        expect(
          (
            await app.inject({
              url: "/internal/cco/snapshot",
              headers: { authorization: `Bearer ${key}` },
            })
          ).statusCode,
        ).toBe(403);
      expect(
        (
          await app.inject({
            url: "/internal/cco/snapshot",
            headers: { authorization: `Bearer ${"r".repeat(40)}` },
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await app.close();
    }
  });
  it("reader key cannot write or bind", async () => {
    const { app } = await setup();
    try {
      for (const url of ["/internal/cco/events", "/internal/cco/bindings"])
        expect(
          (
            await app.inject({
              method: "POST",
              url,
              headers: { authorization: `Bearer ${"r".repeat(40)}` },
              payload: {},
            })
          ).statusCode,
        ).toBe(403);
    } finally {
      await app.close();
    }
  });
  it("producer configuration overrides submitted project/source/authority", async () => {
    const { app, accepted } = await setup();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/internal/cco/events",
        headers: { authorization: `Bearer ${scope.producerKey}` },
        payload: {
          events: [
            {
              version: 1,
              eventId: "a",
              accountId: "account",
              orgId: "forged",
              projectId: "forged",
              source: "forged",
              authority: "forged",
              appKey: "forged",
              environment: "forged",
              operation: "sync.start",
              outcome: "failed",
              errorCode: "TEST_ERROR",
              occurredAt: now,
              replay: null,
            },
          ],
        },
      });
      expect(response.statusCode).toBe(202);
      expect(accepted()[0]?.projectId).toBe("project");
      expect(accepted()[0]?.source).toBe("server.seo");
      expect(accepted()[0]?.authority).toBe("server-reported");
    } finally {
      await app.close();
    }
  });
  it("rejects timestamps too old for live acceptance", async () => {
    const { app } = await setup();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/internal/cco/events",
        headers: { authorization: `Bearer ${scope.producerKey}` },
        payload: {
          events: [
            {
              eventId: "a",
              accountId: "a",
              operation: "start",
              outcome: "failed",
              occurredAt: now - 86400001,
            },
          ],
        },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
