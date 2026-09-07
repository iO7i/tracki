import { type Identity, defaultIdFactory } from "./identity";
import type { Batch, Clock, DeviceInfo, EventInput, Transport } from "./types";

/** Same cadence as the web snippet. */
export const FLUSH_SIZE = 10;
export const FLUSH_INTERVAL_MS = 5000;
/** /v1/events caps a batch at 50 events — split larger buffers. */
const MAX_BATCH = 50;

/**
 * Buffers events and flushes on size / interval / app-background. The ingest
 * response may carry a pending Live Assist — surfaced via the response handler.
 */
export class EventQueue {
  private buffer: EventInput[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onResponse?: (data: unknown) => void;
  private inflight: Promise<void> = Promise.resolve();

  constructor(
    private readonly key: string,
    private readonly eventsUrl: string,
    private readonly identity: Identity,
    private readonly device: DeviceInfo,
    private readonly transport: Transport,
    private readonly now: Clock,
  ) {}

  setResponseHandler(fn: (data: unknown) => void): void {
    this.onResponse = fn;
  }

  enqueue(event: EventInput): void {
    const identified = { ...event, eventId: event.eventId ?? defaultIdFactory("evt") };
    this.identity.touchSession();
    this.buffer.push(identified);
    if (this.buffer.length >= FLUSH_SIZE) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), FLUSH_INTERVAL_MS);
      // Don't hold a Node test process open (no-op on RN/Hermes).
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  /** Send everything buffered. Serialized so batches arrive in order. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return this.inflight;
    const events = this.buffer.splice(0, this.buffer.length);
    this.inflight = this.inflight.then(async () => {
      for (let i = 0; i < events.length; i += MAX_BATCH) {
        const batch: Batch = {
          key: this.key,
          anonId: this.identity.getAnonId(),
          userId: this.identity.getUserId(),
          sessionId: this.identity.currentSession(),
          sentAt: this.now(),
          device: this.device,
          events: events.slice(i, i + MAX_BATCH),
        };
        try {
          const data = await this.transport.post(this.eventsUrl, batch);
          if (data !== undefined) this.onResponse?.(data);
        } catch {
          /* fail-silent: behavioral telemetry must never break the host app */
        }
      }
    });
    return this.inflight;
  }

  /** Test helper. */
  get size(): number {
    return this.buffer.length;
  }
}
