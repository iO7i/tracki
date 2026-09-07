import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventQueue } from "./queue";
import { __reset } from "./storage";
import type { Batch } from "./types";

beforeEach(() => {
  __reset();
  vi.useFakeTimers();
});

function makeQueue() {
  const sent: Batch[] = [];
  const q = new EventQueue("pk_test", "http://localhost/v1/events", (_e, b) => sent.push(b));
  return { q, sent };
}

describe("EventQueue", () => {
  it("flushes at 10 buffered events", () => {
    const { q, sent } = makeQueue();
    for (let i = 0; i < 9; i++) q.enqueue({ type: "click", ts: i });
    expect(sent).toHaveLength(0);
    q.enqueue({ type: "click", ts: 9 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.events).toHaveLength(10);
  });

  it("flushes on the interval", () => {
    const { q, sent } = makeQueue();
    q.enqueue({ type: "pageview", ts: 1 });
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(1);
  });

  it("includes identity fields in the batch", () => {
    const { q, sent } = makeQueue();
    q.enqueue({ type: "pageview", ts: 1 });
    q.flush(false);
    expect(sent[0]?.anonId).toMatch(/^anon_/);
    expect(sent[0]?.sessionId).toMatch(/^sess_/);
    expect(sent[0]?.key).toBe("pk_test");
  });

  it("does not send empty batches", () => {
    const { q, sent } = makeQueue();
    q.flush(false);
    expect(sent).toHaveLength(0);
  });
});

describe("EventQueue consent gate", () => {
  it("holds (never sends) events while consent is pending", () => {
    const { q, sent } = makeQueue();
    q.setInitialConsent("pending");
    for (let i = 0; i < 12; i++) q.enqueue({ type: "click", ts: i });
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(0);
  });

  it("replays held events (capped) once consent is granted", () => {
    const { q, sent } = makeQueue();
    q.setInitialConsent("pending");
    q.enqueue({ type: "pageview", ts: 1 });
    q.enqueue({ type: "click", ts: 2 });
    expect(sent).toHaveLength(0);
    q.setConsent(true);
    q.flush(false);
    expect(sent[0]?.events).toHaveLength(2);
  });

  it("drops everything when consent is denied", () => {
    const { q, sent } = makeQueue();
    q.setInitialConsent("pending");
    q.enqueue({ type: "pageview", ts: 1 });
    q.setConsent(false);
    q.enqueue({ type: "click", ts: 2 });
    q.flush(false);
    expect(sent).toHaveLength(0);
  });

  it("caps the held buffer at 50 events", () => {
    const { q, sent } = makeQueue();
    q.setInitialConsent("pending");
    for (let i = 0; i < 70; i++) q.enqueue({ type: "click", ts: i });
    q.setConsent(true);
    const total = sent.reduce((n, b) => n + b.events.length, 0) + q.size;
    expect(total).toBe(50);
  });
});
