import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventQueue } from "./queue";
import { send } from "./transport";
import type { Batch } from "./types";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const event = () => ({
  type: "click" as const,
  ts: Date.now(),
  props: { password: "demo-password" },
});
const batch: Batch = { key: "pk_x", anonId: "anon", sessionId: "sess", sentAt: 1, events: [] };
describe("resilient browser delivery", () => {
  it("retains failed HTTP delivery, retries with identical IDs, then acknowledges", async () => {
    const sender = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const q = new EventQueue("pk_x", "/events", sender, "granted", { random: () => 0.5 });
    q.enqueue(event());
    q.flush(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(q.size).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(q.size).toBe(0);
    expect(sender.mock.calls[0]?.[1].events[0].eventId).toBe(
      sender.mock.calls[1]?.[1].events[0].eventId,
    );
  });
  it("keeps offline events and flushes on online recovery", async () => {
    const sender = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(true);
    const q = new EventQueue("pk_x", "/events", sender);
    q.enqueue(event());
    q.flush(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(q.size).toBe(1);
    q.online();
    await vi.advanceTimersByTimeAsync(0);
    expect(q.size).toBe(0);
  });
  it("persists only scrubbed data and resumes after a page closes", async () => {
    const sender = vi.fn().mockResolvedValue(false);
    const q = new EventQueue("pk_x", "/events", sender, "granted", { storage: localStorage });
    q.enqueue(event());
    q.flush(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(q.size).toBe(1);
    expect(JSON.stringify(localStorage)).not.toContain("demo-password");
    const receiver = vi.fn().mockResolvedValue(true);
    const restored = new EventQueue("pk_x", "/events", receiver, "pending", {
      storage: localStorage,
    });
    restored.flush(false);
    expect(receiver).not.toHaveBeenCalled();
    restored.setConsent(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(restored.size).toBe(0);
    expect(receiver).toHaveBeenCalledTimes(1);
  });
  it("withdrawal clears storage and ignores late completion", async () => {
    let finish: (v: boolean) => void = () => {};
    const sender = vi.fn(
      () =>
        new Promise<boolean>((r) => {
          finish = r;
        }),
    );
    const q = new EventQueue("pk_x", "/events", sender, "granted", { storage: localStorage });
    q.enqueue(event());
    q.flush(false);
    q.setConsent(false);
    finish(false);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(q.size).toBe(0);
    expect(localStorage.getItem("tracki_delivery:pk_x:/events")).toBeNull();
    expect(sender).toHaveBeenCalledTimes(1);
    q.setConsent(true);
    q.online();
    expect(sender).toHaveBeenCalledTimes(1);
  });
  it("bounds an offline queue", () => {
    const q = new EventQueue("pk_x", "/events", () => new Promise(() => {}));
    for (let i = 0; i < 1000; i++) q.enqueue(event());
    expect(q.size).toBeLessThanOrEqual(200);
  });
  it("bounds persistent UTF-8 bytes including multibyte text", () => {
    const q = new EventQueue("pk_x", "/events", () => new Promise(() => {}), "granted", {
      storage: localStorage,
    });
    for (let i = 0; i < 100; i++) q.enqueue({ ...event(), props: { text: "مرحبا".repeat(500) } });
    const raw = localStorage.getItem("tracki_delivery:pk_x:/events") ?? "";
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(48_000);
    expect(q.size).toBeGreaterThan(0);
  });
  it("HTTP errors and network failures are not acknowledgments", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockRejectedValueOnce(new Error("offline")),
    );
    expect(await send("/events", batch, false)).toBe(false);
    expect(await send("/events", batch, false)).toBe(false);
  });
  it("a rejected beacon falls back to fetch; an accepted beacon remains unacknowledged", async () => {
    const beacon = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetcher);
    expect(await send("/events", batch, true)).toBe(true);
    expect(await send("/events", batch, true)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
