import { describe, expect, it } from "vitest";
import { safeNativeRoute, sanitizeMobileEvent, sanitizeNativeCorrelation, sanitizeNativeHealth } from "./mobile-diagnostics";
describe("canonical native privacy contract", () => {
  it("retains approved real-app semantic routes while removing identities and query/input values", () => {
    expect(safeNativeRoute("https://backend.test/api/hr/leave/customer-name?email=private#secret")).toBe("/api/hr/leave/:id");
    expect(safeNativeRoute("/app/transcripts/1fc240f8-037c-448a-a5c2-f5bb6d2d311d")).toBe("/app/transcripts/:id");
  });
  it("keeps fixed evidence and generated correlation references only", () => {
    const event = sanitizeMobileEvent({ type: "error", ts: Date.now(), path: "/hr/expenses", props: { code: "JS_ERROR", message: "employee transcript", password: "private" }, fingerprint: "f".repeat(32), correlation: { operationId: "a".repeat(32) } });
    expect(event?.props).toEqual({ code: "JS_ERROR" }); expect(event?.correlation?.operationId).toBe("a".repeat(32));
    expect(sanitizeNativeCorrelation({ operationId: "customer@example.com", requestId: "free-form-user-text" })).toEqual({});
  });
  it("rejects malformed health counters and retains only the bounded fixed report", () => {
    expect(sanitizeNativeHealth({ reporterId: "arbitrary user label", revision: 1 })).toBeNull();
  });
});
