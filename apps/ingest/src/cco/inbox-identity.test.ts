import type { StoredEvent } from "@tracki/shared";
import type postgres from "postgres";
import postgresClient from "postgres";
import { describe, expect, it, vi } from "vitest";
import { acceptEvents, assertInboxRetryMatches, ensureInbox } from "../inbox";
import { acceptTrustedBrowser } from "./trusted-browser";

function memoryInbox(): postgres.Sql {
  let committed = new Map<string, unknown>();
  const tagged = (state: Map<string, unknown>): postgres.Sql => {
    const query = ((parts: TemplateStringsArray, ...values: unknown[]) => {
      const statement = parts.join(" ").replace(/\s+/g, " ").trim();
      const key = `${String(values[0])}\u0000${String(values[1])}`;
      if (statement.startsWith("INSERT INTO telemetry_inbox")) {
        if (state.has(key)) return Promise.resolve([]);
        state.set(key, values[4]);
        return Promise.resolve([{ event_id: values[1] }]);
      }
      if (statement.startsWith("SELECT payload FROM telemetry_inbox")) {
        return Promise.resolve(state.has(key) ? [{ payload: state.get(key) }] : []);
      }
      throw new Error("unexpected_inbox_test_query");
    }) as unknown as postgres.Sql;
    Object.assign(query, { json: (value: unknown) => value });
    return query;
  };
  const root = tagged(committed);
  Object.assign(root, {
    begin: async (run: (tx: unknown) => Promise<unknown>) => {
      const draft = new Map(committed);
      const result = await run(tagged(draft));
      committed = draft;
      return result;
    },
  });
  return root;
}

const project = {
  orgId: "org",
  projectId: "project",
  appKey: "seo",
  environment: "test",
  producerKey: "p".repeat(40),
};

describe("trusted browser inbox identity", () => {
  it("accepts exact retries, ignores receiver time, and conflicts on changed safe payload", async () => {
    vi.stubEnv("TRACKI_CCO_ENABLED", "false");
    try {
      const sql = memoryInbox();
      const now = Date.now();
      const eventId = `browser_${now}`;
      const traceId = "a".repeat(32);
      const spanId = "b".repeat(16);
      const binding = {
        actorKind: "human",
        accountId: "trusted-account",
        anonId: eventId,
        sessionId: eventId,
        installationId: "trusted-install",
        generation: 3,
        validFrom: now - 1000,
        expiresAt: now + 60_000,
      };
      const batch = (statusCode: number) => ({
        authorizedAt: Date.now(),
        binding,
        batch: {
          key: "pk_test",
          anonId: eventId,
          sessionId: eventId,
          sentAt: now + 30_000,
          events: [
            {
              eventId,
              type: "track",
              ts: now + 30_000,
              path: "/account/plan",
              traceContext: { traceId, spanId },
              props: { name: "cco_request", statusCode },
            },
          ],
        },
      });
      const receive = (statusCode: number) =>
        acceptTrustedBrowser(batch(statusCode), project, (events, scope) =>
          acceptEvents(events, sql, scope),
        );

      await expect(receive(200)).resolves.toEqual({ acceptedClientIds: [eventId] });
      vi.spyOn(Date, "now").mockReturnValue(now + 1000);
      await expect(receive(200)).resolves.toEqual({ acceptedClientIds: [eventId] });
      await expect(receive(500)).rejects.toMatchObject({
        code: "telemetry_event_identity_conflict",
        status: 409,
      });
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  it("treats missing or purged prior payload as unverifiable instead of a successful retry", () => {
    const event = {
      org_id: "org",
      project_id: "project",
      anon_id: "anon",
      user_id: "",
      session_id: "session",
      event_id: "event",
      type: "pageview",
      path: "/",
      url: "",
      referrer: "",
      props: "{}",
      ua: "Chrome/Windows",
      platform: "web",
      app_version: "",
      device_model: "",
      ts: 1,
      received_at: 1,
    } satisfies StoredEvent;
    expect(() => assertInboxRetryMatches({ ...event, received_at: 2 }, event)).not.toThrow();
    let conflict: unknown;
    try {
      assertInboxRetryMatches(null, event);
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toMatchObject({ code: "telemetry_event_identity_conflict", status: 409 });
  });

  it.skipIf(!process.env.CCO_TEST_DATABASE_URL)(
    "enforces browser retry identity in a PostgreSQL-compatible database",
    async () => {
      vi.stubEnv("TRACKI_CCO_ENABLED", "false");
      const sql = postgresClient(process.env.CCO_TEST_DATABASE_URL as string, { max: 1 });
      let storedEventId: string | null = null;
      try {
        await ensureInbox(sql);
        const now = Date.now();
        const eventId = `pg_${now}_${Math.random().toString(36).slice(2, 10)}`;
        const traceId = "c".repeat(32);
        const binding = {
          actorKind: "human",
          accountId: "trusted-account",
          anonId: eventId,
          sessionId: eventId,
          installationId: "trusted-install",
          generation: 3,
          validFrom: now - 1000,
          expiresAt: now + 60_000,
        };
        const body = (statusCode: number) => ({
          authorizedAt: Date.now(),
          binding,
          batch: {
            key: "pk_test",
            anonId: eventId,
            sessionId: eventId,
            sentAt: now + 30_000,
            events: [
              {
                eventId,
                type: "track",
                ts: now + 30_000,
                path: "/account/plan",
                traceContext: { traceId, spanId: "d".repeat(16) },
                props: { name: "cco_request", statusCode },
              },
            ],
          },
        });
        const receive = (statusCode: number) =>
          acceptTrustedBrowser(body(statusCode), project, async (events, scope) => {
            storedEventId = events[0]?.event_id ?? null;
            return acceptEvents(events, sql, scope);
          });

        await expect(receive(200)).resolves.toEqual({ acceptedClientIds: [eventId] });
        await expect(receive(200)).resolves.toEqual({ acceptedClientIds: [eventId] });
        await expect(receive(500)).rejects.toMatchObject({
          code: "telemetry_event_identity_conflict",
          status: 409,
        });
        const rows = await sql<{ payload: StoredEvent }[]>`
          SELECT payload FROM telemetry_inbox WHERE project_id='project' AND event_id=${storedEventId}`;
        expect(rows).toHaveLength(1);
        const savedProps = rows[0]?.payload.props ?? "{}";
        expect(JSON.parse(savedProps)).toMatchObject({ name: "cco_request", statusCode: 200 });
      } finally {
        if (storedEventId)
          await sql`DELETE FROM telemetry_inbox WHERE project_id='project' AND event_id=${storedEventId}`;
        await sql.end();
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
      }
    },
  );
});
