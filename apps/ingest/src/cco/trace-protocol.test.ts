import { eventBatchSchema } from "@tracki/shared";
import { expect, it } from "vitest";
import { normalizeBatch } from "../normalize";
import { projectBehavior } from "./projection";
import { parseBinding } from "./store";
const scope = {
  orgId: "org",
  projectId: "project",
  appKey: "seo",
  environment: "test",
  producerKey: "p".repeat(40),
};
const trace = { traceId: "a".repeat(32), spanId: "b".repeat(16) };
function input() {
  const now = Date.now();
  return {
    key: "pk_test",
    anonId: "_anon",
    sessionId: "-session",
    sentAt: now,
    events: [
      {
        eventId: "event",
        type: "track",
        ts: now,
        traceContext: trace,
        props: { name: "cco_request", token: "c".repeat(32) },
      },
    ],
  };
}
it("typed trace survives normalization while raw hexadecimal credentials remain masked", () => {
  const batch = eventBatchSchema.parse(input());
  const result = normalizeBatch(batch, scope, "", Date.now())[0];
  expect(result).toBeDefined();
  if (!result) throw new Error("missing fixture");
  const props = JSON.parse(result.props);
  expect(props.ccoTrace).toEqual(trace);
  expect(result.props).not.toContain("c".repeat(32));
  expect(projectBehavior(result, scope).traceId).toBe(trace.traceId);
});
it("correlation metadata cannot be smuggled through arbitrary properties", () => {
  const data = input();
  const batch = eventBatchSchema.parse({
    ...data,
    events: data.events.map((e) => ({
      ...e,
      traceContext: undefined,
      props: { ccoTrace: trace, name: "cco_request" },
    })),
  });
  const result = normalizeBatch(batch, scope, "", Date.now())[0];
  if (!result) throw new Error("missing fixture");
  expect(projectBehavior(result, scope).traceId).toBeNull();
});
it("malformed typed traces are rejected by the wire protocol", () => {
  const data = input();
  for (const bad of ["0".repeat(32), "secret", "A".repeat(32)])
    expect(
      eventBatchSchema.safeParse({
        ...data,
        events: data.events.map((e) => ({ ...e, traceContext: { ...trace, traceId: bad } })),
      }).success,
    ).toBe(false);
});
it("binding accepts valid legacy correlation IDs without accepting non-string values", () => {
  const now = Date.now();
  const binding = {
    accountId: "account",
    anonId: "_anon",
    sessionId: "-session",
    validFrom: now,
    expiresAt: now + 10000,
  };
  expect(() => parseBinding(binding, scope, now)).not.toThrow();
  for (const anonId of [undefined, null, 123, {}, []])
    expect(() => parseBinding({ ...binding, anonId }, scope, now)).toThrow();
});
