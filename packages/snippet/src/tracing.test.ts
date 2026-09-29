import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventQueue } from "./queue";
import { tracedFetch } from "./tracing";
afterEach(() => vi.unstubAllGlobals());
function setup() {
  vi.stubGlobal("location", {
    href: "https://app.example.test/products",
    origin: "https://app.example.test",
  });
  const send = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", send);
  const enqueue = vi.fn();
  return { send, enqueue, queue: { enqueue } as unknown as EventQueue };
}
describe("CCO browser tracing", () => {
  it("does not attach context without consent", async () => {
    const { send, queue, enqueue } = setup();
    await tracedFetch(queue, "/api/test", undefined, false);
    expect(send.mock.calls[0]?.[1]).toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("does not send first-party trace context to providers", async () => {
    const { send, queue, enqueue } = setup();
    await tracedFetch(queue, "https://payments.example.test/", undefined, true);
    expect(send.mock.calls[0]?.[1]).toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("adds a valid trace to explicit same-origin requests only", async () => {
    const { send, queue, enqueue } = setup();
    await tracedFetch(queue, "/api/test?secret=discard", undefined, true);
    expect(send.mock.calls[0]?.[1].headers.get("traceparent")).toMatch(
      /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/,
    );
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(enqueue.mock.calls)).not.toContain("discard");
  });
  it("does not replace another tracer context", async () => {
    const { send, queue, enqueue } = setup();
    await tracedFetch(queue, "/api/test", { headers: { traceparent: "existing" } }, true);
    expect(send.mock.calls[0]?.[1].headers.traceparent).toBe("existing");
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("retains network error semantics without capturing error text", async () => {
    const { send, queue, enqueue } = setup();
    send.mockRejectedValue(new Error("secret"));
    await expect(tracedFetch(queue, "/api/test", undefined, true)).rejects.toThrow("secret");
    expect(JSON.stringify(enqueue.mock.calls)).not.toContain("secret");
  });
});
