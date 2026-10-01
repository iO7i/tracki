import { describe, expect, it } from "vitest";
import { normalizedErrorFingerprint, observeJavaScriptErrors, observeUnhandledRejections } from "./diagnostics";
describe("bounded error observers", () => {
  it("groups recognized numeric bundle frames without message/input/path content", () => {
    const a = { stack: "secret customer text\n at checkout (/private/index.android.bundle:123:45)" };
    const b = { stack: "different secret\n at payment (/other/index.android.bundle:123:45)" };
    expect(normalizedErrorFingerprint(a)).toMatch(/^[a-f0-9]{32}$/);
    expect(normalizedErrorFingerprint(a)).toBe(normalizedErrorFingerprint(b));
    expect(normalizedErrorFingerprint({ stack: "message\n at secret-customer-path:123:45" })).toBeUndefined();
  });
  it("preserves the host error handler and does not overwrite a later observer", () => {
    const errors: string[] = []; let originalCalls = 0;
    let handler: (error: unknown, isFatal?: boolean) => void = () => { originalCalls++; };
    const source = { getGlobalHandler: () => handler, setGlobalHandler: (next: typeof handler) => { handler = next; } };
    const off = observeJavaScriptErrors({ error: code => errors.push(code) }, source);
    handler(new Error("private")); expect(originalCalls).toBe(1); expect(errors).toEqual(["JS_ERROR"]);
    const later = () => {}; handler = later; off(); expect(handler).toBe(later);
  });
  it("uses an explicit rejection source and unsubscribes", () => {
    let listener: ((reason: unknown) => void) | undefined; let ended = false; const codes: string[] = [];
    const off = observeUnhandledRejections({ error: code => codes.push(code) }, { subscribe: callback => { listener = callback; return () => { ended = true; }; } });
    listener?.("private text"); off(); listener?.("more text"); expect(codes).toEqual(["JS_ERROR"]); expect(ended).toBe(true);
  });
});
