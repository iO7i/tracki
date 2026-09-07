import { getAnonId, getSessionId, getUserId } from "./storage";
import { send } from "./transport";
import type { Batch, EventInput } from "./types";

const FLUSH_SIZE = 10;
const FLUSH_INTERVAL_MS = 5000;
const MAX_HELD = 50;

export type ConsentState = "granted" | "denied" | "pending";

/**
 * Buffers events and flushes on size / interval / page-hide. Decoupled from
 * capture so it is unit-testable with an injected sender.
 *
 * Consent gate (privacy): nothing is transmitted unless consent is "granted".
 * While "pending" (opt-in default) events are HELD in memory — never sent — up
 * to MAX_HELD, then replayed if consent is later granted or discarded if denied.
 * "denied" drops everything, including anything buffered-but-not-yet-flushed.
 * The gate lives here so EVERY producer (auto-capture, track, actions, assist)
 * is covered uniformly.
 */
export class EventQueue {
  private buffer: EventInput[] = [];
  private held: EventInput[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  private onResponse?: (data: unknown) => void;

  constructor(
    private readonly key: string,
    private readonly endpoint: string,
    private readonly sender: (
      endpoint: string,
      batch: Batch,
      beacon: boolean,
      onResponse?: (data: unknown) => void,
    ) => void = send,
    private consent: ConsentState = "granted",
  ) {}

  /** Handler for the ingest response (e.g. a pending Live Assist). */
  setResponseHandler(fn: (data: unknown) => void): void {
    this.onResponse = fn;
  }

  /** Set the starting consent state. Call before any producer runs. */
  setInitialConsent(state: ConsentState): void {
    this.consent = state;
  }

  /** Update consent. Granting replays held events; denying discards everything. */
  setConsent(granted: boolean): void {
    if (granted) {
      this.consent = "granted";
      const held = this.held;
      this.held = [];
      for (const e of held) this.enqueue(e);
    } else {
      this.consent = "denied";
      this.held = [];
      this.buffer = [];
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    }
  }

  enqueue(event: EventInput): void {
    if (this.consent === "denied") return;
    if (this.consent === "pending") {
      if (this.held.length >= MAX_HELD) this.held.shift();
      this.held.push(event);
      return;
    }
    this.buffer.push(event);
    if (this.buffer.length >= FLUSH_SIZE) {
      this.flush(false);
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(false), FLUSH_INTERVAL_MS);
    }
  }

  flush(beacon: boolean): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return;
    const events = this.buffer;
    this.buffer = [];
    const batch: Batch = {
      key: this.key,
      anonId: getAnonId(),
      userId: getUserId(),
      sessionId: getSessionId(),
      sentAt: Date.now(),
      events,
    };
    this.sender(this.endpoint, batch, beacon, beacon ? undefined : this.onResponse);
  }

  /** Test helper. */
  get size(): number {
    return this.buffer.length;
  }
}
