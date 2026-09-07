import { type EventBatch, eventBatchSchema } from "@tracki/shared";
import { describe, expect, it } from "vitest";
import { detectBatch } from "./detector";
import { normalizeBatch } from "./normalize";
import { scrubString, scrubValue } from "./scrub";
import { InMemoryStateStore } from "./state";

const now = 1_800_000_000_000;
const ref = { orgId: "org", projectId: "project" };
function batch(offsets = [0, 4000, 8000]): EventBatch {
  return {
    key: "pk_test",
    anonId: "anon",
    sessionId: "session",
    sentAt: now,
    events: offsets.map((t, i) => ({
      eventId: `evt_${i}`,
      type: "click",
      ts: now - 8000 + t,
      path: "/buy",
      props: { tag: "button", id: "buy" },
    })),
  };
}
describe("normalization and detection regression", () => {
  it("does not turn eight seconds of clicks into a three-second burst", async () => {
    expect(
      await detectBatch(new InMemoryStateStore(() => now), normalizeBatch(batch(), ref, "", now)),
    ).toEqual([]);
  });
  it("detects a genuine burst even when submitted out of order", async () => {
    const input = batch([8000, 7000, 7500]);
    expect(
      (await detectBatch(new InMemoryStateStore(() => now), normalizeBatch(input, ref, "", now)))[0]
        ?.type,
    ).toBe("rage_click");
  });
  it("preserves spacing under bounded positive clock skew", () => {
    const input = batch();
    input.sentAt += 60_000;
    for (const e of input.events) e.ts += 60_000;
    expect(normalizeBatch(input, ref, "", now).map((e) => e.ts)).toEqual(
      batch().events.map((e) => e.ts),
    );
  });
  it("rejects expired, missing, invalid and far-future times", () => {
    for (const ts of [0, Number.NaN, now - 86_400_001, now + 120_001]) {
      const input = batch();
      if (input.events[0]) input.events[0].ts = ts;
      expect(() => normalizeBatch(input, ref, "", now)).toThrow();
    }
    expect(eventBatchSchema.safeParse({ ...batch(), events: [{ type: "click" }] }).success).toBe(
      false,
    );
  });
  it("keeps event identities stable for partial retry and scopes them to tenants", () => {
    const a = normalizeBatch(batch(), ref, "", now);
    const input = batch();
    input.sentAt += 1000;
    input.events = input.events.slice(1);
    expect(normalizeBatch(input, ref, "", now + 1000).map((e) => e.event_id)).toEqual(
      a.slice(1).map((e) => e.event_id),
    );
    expect(normalizeBatch(batch(), { ...ref, projectId: "other" }, "", now)[0]?.event_id).not.toBe(
      a[0]?.event_id,
    );
  });
  it("rejects abusive session identifiers", () => {
    for (const sessionId of ["", "x".repeat(65), "other:session", "a\nb", "a/b"]) {
      expect(eventBatchSchema.safeParse({ ...batch(), sessionId }).success).toBe(false);
    }
  });
});
describe("privacy regressions", () => {
  it("redacts credentials recursively independent of their values", () => {
    const result = scrubValue({
      password: "demo-password",
      authorization: "Bearer exampleOpaqueToken",
      nested: [{ Api_Key: "opaque", CLIENTsecret: 123, refresh_token: "value" }],
    });
    expect(JSON.stringify(result)).not.toMatch(/demo-password|exampleOpaqueToken|opaque|123|value/);
    expect(JSON.stringify(result)).toContain("[redacted]");
  });
  it("scrubs encoded query keys and values while preserving harmless structure", () => {
    const safe = scrubString(
      "https://example.test/path?q=hello%20world&email=person%40example.test&%70assword=demo-password",
    );
    expect(safe).toContain("q=hello%20world");
    expect(safe).not.toContain("person%40");
    expect(safe).not.toContain("demo-password");
    expect(decodeURIComponent(safe)).toContain("password=[redacted]");
  });
});
