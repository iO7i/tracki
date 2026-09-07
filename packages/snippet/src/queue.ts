import { scrubProperties, scrubText } from "@tracki/shared/pii";
import { randomId } from "./ids";
import { getAnonId, getSessionId, getUserId } from "./storage";
import { send } from "./transport";
import type { Batch, EventInput } from "./types";

export type ConsentState = "granted" | "denied" | "pending";
type Entry = { event: EventInput; anonId: string; userId?: string; sessionId: string };
type Sender = (
  endpoint: string,
  batch: Batch,
  beacon: boolean,
  response?: (v: unknown) => void,
) => unknown;
export interface QueueOptions {
  storage?: Storage;
  random?: () => number;
  now?: () => number;
}
const MAX_EVENTS = 200;
const MAX_BYTES = 48_000;
const MAX_AGE = 23 * 60 * 60 * 1000;

export class EventQueue {
  private buffer: Entry[] = [];
  private held: EventInput[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private generation = 0;
  private failures = 0;
  private restored = false;
  private onResponse?: (data: unknown) => void;
  private readonly storage?: Storage;
  private readonly storageKey: string;
  private readonly now: () => number;
  private readonly random: () => number;
  constructor(
    private key: string,
    private endpoint: string,
    private sender: Sender = send,
    private consent: ConsentState = "granted",
    options: QueueOptions = {},
  ) {
    this.storageKey = `tracki_delivery:${key}:${endpoint}`;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    try {
      this.storage = options.storage ?? (sender === send ? localStorage : undefined);
    } catch {
      /* memory fallback */
    }
  }
  setResponseHandler(fn: (data: unknown) => void): void {
    this.onResponse = fn;
  }
  setInitialConsent(state: ConsentState): void {
    this.consent = state;
    if (state === "denied") this.setConsent(false);
    if (state === "granted") this.restore();
  }
  private restore(): void {
    if (this.restored || this.consent !== "granted") return;
    this.restored = true;
    try {
      const raw = this.storage?.getItem(this.storageKey);
      if (raw && raw.length <= MAX_BYTES) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed))
          this.buffer = parsed
            .filter(
              (x): x is Entry =>
                !!x?.event?.eventId &&
                typeof x.event.ts === "number" &&
                typeof x.anonId === "string" &&
                typeof x.sessionId === "string",
            )
            .slice(-MAX_EVENTS);
      }
    } catch {
      /* corrupt storage is discarded */
    }
    this.bound();
    if (this.buffer.length) this.schedule(0);
  }
  setConsent(granted: boolean): void {
    this.consent = granted ? "granted" : "denied";
    if (!granted) {
      this.generation++;
      this.buffer = [];
      this.held = [];
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      try {
        this.storage?.removeItem(this.storageKey);
      } catch {
        /* unavailable */
      }
      return;
    }
    this.restore();
    const held = this.held;
    this.held = [];
    for (const event of held) this.enqueue(event);
  }
  enqueue(input: EventInput): void {
    if (this.consent === "denied") return;
    const event: EventInput = {
      ...input,
      eventId: input.eventId ?? randomId("evt"),
      path: input.path ? scrubText(input.path) : undefined,
      url: input.url ? scrubText(input.url) : undefined,
      referrer: input.referrer ? scrubText(input.referrer) : undefined,
      props: input.props ? (scrubProperties(input.props) as Record<string, unknown>) : undefined,
    };
    if (JSON.stringify(event).length > 8192) return;
    if (this.consent === "pending") {
      if (this.held.length >= 50) this.held.shift();
      this.held.push(event);
      return;
    }
    this.restore();
    this.buffer.push({
      event,
      anonId: getAnonId(),
      userId: getUserId(),
      sessionId: getSessionId(),
    });
    this.bound();
    if (this.buffer.length >= 10 && !this.failures) this.flush(false);
    else this.schedule(5000);
  }
  private bound(): void {
    this.buffer = this.buffer.filter((e) => e.event.ts >= this.now() - MAX_AGE).slice(-MAX_EVENTS);
    while (JSON.stringify(this.buffer).length > MAX_BYTES) this.buffer.shift();
    try {
      this.storage?.setItem(this.storageKey, JSON.stringify(this.buffer));
    } catch {
      /* retain memory */
    }
  }
  private schedule(ms: number): void {
    if (!this.timer && this.consent === "granted")
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush(false);
      }, ms);
  }
  /** Call on browser online. Backoff remains bounded, with no retry-count data loss. */
  online(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.flush(false);
  }
  flush(beacon: boolean): void {
    if (this.consent !== "granted") return;
    this.bound();
    if (!this.buffer.length || (this.busy && !beacon)) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const first = this.buffer[0];
    if (!first) return;
    const entries: Entry[] = [];
    for (const item of this.buffer) {
      if (
        entries.length >= 10 ||
        item.anonId !== first.anonId ||
        item.userId !== first.userId ||
        item.sessionId !== first.sessionId
      )
        break;
      if (JSON.stringify([...entries, item]).length > MAX_BYTES) break;
      entries.push(item);
    }
    const batch: Batch = {
      key: this.key,
      anonId: first.anonId,
      userId: first.userId,
      sessionId: first.sessionId,
      sentAt: this.now(),
      events: entries.map((x) => x.event),
    };
    const generation = this.generation;
    if (!beacon) this.busy = true;
    const done = (ok: boolean) => {
      if (!beacon) this.busy = false;
      if (generation !== this.generation || this.consent !== "granted") return;
      if (ok) {
        const ids = new Set(entries.map((e) => e.event.eventId));
        this.buffer = this.buffer.filter((e) => !ids.has(e.event.eventId));
        this.failures = 0;
      } else this.failures++;
      this.bound();
      if (this.buffer.length)
        this.schedule(
          ok
            ? 0
            : Math.min(60_000, 1000 * 2 ** Math.min(this.failures, 6)) *
                (0.75 + this.random() * 0.5),
        );
    };
    try {
      const result = this.sender(this.endpoint, batch, beacon, (v) => {
        if (generation === this.generation && this.consent === "granted") this.onResponse?.(v);
      });
      if (result && typeof (result as Promise<unknown>).then === "function")
        void Promise.resolve(result).then(
          (v) => done(v === true),
          () => done(false),
        );
      else done(result !== false); // synchronous injected senders used by capture tests
    } catch {
      done(false);
    }
  }
  get size(): number {
    return this.buffer.length;
  }
}
