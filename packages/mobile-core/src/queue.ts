import { nativeBuild, sanitizeMobileEvent } from "@tracki/shared/mobile-diagnostics";
import { type Identity, defaultIdFactory } from "./identity";
import type {
  Batch,
  BuildIdentity,
  Clock,
  DeviceInfo,
  EventInput,
  KeyValueStorage,
  Transport,
} from "./types";

export const FLUSH_SIZE = 10;
export const FLUSH_INTERVAL_MS = 5000;
export const MAX_QUEUE_EVENTS = 500;
export const MAX_QUEUE_AGE_MS = 23 * 60 * 60 * 1000;
const MAX_QUEUE_BYTES = 512 * 1024;
const MAX_BATCH = 50;

interface StoredBatch {
  batch: Batch;
  sealed: boolean;
}
interface QueueOptions {
  storage?: KeyValueStorage;
  storageNamespace?: string;
  scopeTag?: () => string | undefined;
  build?: BuildIdentity;
  allowed?: (event: EventInput) => boolean;
}

function safeDevice(device: DeviceInfo): DeviceInfo {
  const tag = (v: unknown): string | undefined =>
    typeof v === "string" && /^[A-Za-z0-9_.:-]{1,32}$/.test(v) ? v : undefined;
  return {
    platform: device.platform,
    sdk: device.sdk,
    osVersion: tag(device.osVersion),
    appVersion: tag(device.appVersion),
  };
}

/** Durable bounded outbox. Identity, scope and sentAt are fixed before network delivery. */
export class EventQueue {
  private buffer: StoredBatch[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onResponse?: (data: unknown) => void;
  private inflight: Promise<void> = Promise.resolve();
  private writes: Promise<void> = Promise.resolve();
  private running = false;
  private disposed = false;
  private generation = 0;
  private failures = 0;
  private persistenceHealthy = true;
  private readonly storageKey: string;

  constructor(
    private readonly key: string,
    private readonly eventsUrl: string,
    private readonly identity: Identity,
    private readonly device: DeviceInfo,
    private transport: Transport,
    private readonly now: Clock,
    private readonly options: QueueOptions = {},
  ) {
    this.storageKey = `${options.storageNamespace ?? "tracki:v2:default"}:queue`;
  }

  async hydrate(): Promise<void> {
    if (!this.options.storage) return;
    let raw: string | null;
    try {
      raw = await this.options.storage.get(this.storageKey);
    } catch (error) {
      this.persistenceHealthy = false;
      throw error;
    }
    try {
      const parsed: unknown = raw && raw.length <= MAX_QUEUE_BYTES * 2 ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        for (const value of parsed) {
          const item = value as Partial<StoredBatch> | null;
          const b = item?.batch;
          if (
            !b ||
            b.key !== this.key ||
            !Array.isArray(b.events) ||
            b.events.length > MAX_BATCH ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(b.anonId) ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(b.sessionId) ||
            (b.userId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(b.userId)) ||
            !Number.isFinite(b.sentAt) ||
            !b.device ||
            !["ios", "android"].includes(b.device.platform)
          )
            continue;
          const events = b.events.flatMap((event) => {
            const safe = sanitizeMobileEvent(event);
            return safe && typeof event.eventId === "string"
              ? [{ ...safe, eventId: safe.eventId ?? defaultIdFactory("evt") }]
              : [];
          });
          if (events.length) {
            this.buffer.push({
              batch: {
                key: this.key,
                anonId: b.anonId,
                userId: b.userId,
                sessionId: b.sessionId,
                sentAt: b.sentAt,
                device: safeDevice(b.device),
                scopeTag: b.scopeTag,
                build: nativeBuild(b.build),
                events,
              },
              sealed: true,
            });
          }
        }
      }
    } catch {
      /* Missing/corrupt persistence must never break the app. */
    }
    this.prune();
    await this.persist();
    if (this.deliverable()) this.schedule(FLUSH_INTERVAL_MS);
  }

  private allowed(event: EventInput): boolean {
    return this.options.allowed?.(event) ?? true;
  }
  private deliverable(): boolean {
    return this.buffer.some(
      (item) =>
        item.batch.scopeTag === this.options.scopeTag?.() &&
        item.batch.events.some((event) => this.allowed(event)),
    );
  }
  setResponseHandler(fn: (data: unknown) => void): void {
    this.onResponse = fn;
  }
  setTransport(transport: Transport): void {
    this.transport = transport;
  }

  enqueue(event: EventInput): void {
    if (this.disposed) return;
    const safe = sanitizeMobileEvent(event);
    if (
      !safe ||
      !this.allowed(safe) ||
      safe.ts < this.now() - MAX_QUEUE_AGE_MS ||
      safe.ts > this.now() + 60000
    )
      return;
    this.identity.touchSession();
    const anonId = this.identity.getAnonId();
    const userId = this.identity.getUserId();
    const sessionId = this.identity.currentSession();
    const scopeTag = this.options.scopeTag?.();
    const identified: EventInput = { ...safe, eventId: safe.eventId ?? defaultIdFactory("evt") };
    let tail = this.buffer[this.buffer.length - 1];
    if (
      !tail ||
      tail.sealed ||
      tail.batch.events.length >= MAX_BATCH ||
      tail.batch.anonId !== anonId ||
      tail.batch.userId !== userId ||
      tail.batch.sessionId !== sessionId ||
      tail.batch.scopeTag !== scopeTag
    ) {
      tail = {
        batch: {
          key: this.key,
          anonId,
          userId,
          sessionId,
          sentAt: this.now(),
          device: safeDevice(this.device),
          build: nativeBuild(this.options.build),
          scopeTag,
          events: [],
        },
        sealed: false,
      };
      this.buffer.push(tail);
    }
    tail.batch.events.push(identified);
    this.prune();
    void this.persist().catch(() => {});
    if (this.size >= FLUSH_SIZE && this.failures === 0) void this.flush();
    else this.schedule(this.retryDelay());
  }

  private retryDelay(): number {
    return Math.min(5 * 60 * 1000, FLUSH_INTERVAL_MS * 2 ** Math.min(this.failures, 6));
  }
  private schedule(delay: number): void {
    if (this.disposed || this.timer || !this.deliverable()) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
    (this.timer as { unref?: () => void }).unref?.();
  }
  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private prune(): void {
    const cutoff = this.now() - MAX_QUEUE_AGE_MS;
    this.buffer = this.buffer.filter(
      (item) => item.batch.sentAt >= cutoff && item.batch.sentAt <= this.now() + 60_000,
    );
    for (const item of this.buffer)
      item.batch.events = item.batch.events.filter((event) => event.ts >= cutoff);
    this.buffer = this.buffer.filter((item) => item.batch.events.length > 0);
    while (this.size > MAX_QUEUE_EVENTS || JSON.stringify(this.buffer).length > MAX_QUEUE_BYTES)
      this.buffer.shift();
  }
  private persist(snapshot = JSON.stringify(this.buffer)): Promise<void> {
    this.writes = this.writes
      .catch(() => undefined)
      .then(async () => {
        try {
          if (!this.options.storage) throw new Error("Tracki queue requires durable storage");
          if (snapshot === "[]" && this.options.storage.remove)
            await this.options.storage.remove(this.storageKey);
          else await this.options.storage.set(this.storageKey, snapshot);
          this.persistenceHealthy = true;
        } catch (error) {
          this.persistenceHealthy = false;
          throw error;
        }
      });
    return this.writes;
  }

  /** Only explicitly acknowledged client event ids are removed. Lost acknowledgments are retried. */
  flush(): Promise<void> {
    this.cancelTimer();
    if (this.disposed || this.running) return this.inflight;
    this.running = true;
    const generation = this.generation;
    this.inflight = (async () => {
      this.prune();
      while (this.buffer.length && generation === this.generation && !this.disposed) {
        const item = this.buffer[0];
        if (!item) break;
        if (
          item.batch.scopeTag !== this.options.scopeTag?.() ||
          item.batch.events.some((event) => !this.allowed(event))
        )
          break;
        item.sealed = true;
        // Snapshot the payload: expiry, policy changes or bounds pruning during
        // an asynchronous transport must not alter the submitted envelope.
        const payload: Batch = JSON.parse(JSON.stringify(item.batch));
        try {
          await this.persist();
        } catch {
          this.failures++;
          break;
        }
        if (generation !== this.generation || this.disposed) break;
        try {
          const data = await this.transport.post(this.eventsUrl, payload);
          if (generation !== this.generation || this.disposed) break;
          const ack = data as { acceptedClientIds?: unknown } | null;
          if (
            !Array.isArray(ack?.acceptedClientIds) ||
            ack.acceptedClientIds.some((id) => typeof id !== "string")
          ) {
            throw new Error("Tracki response omitted acceptedClientIds");
          }
          const expected = new Set(payload.events.map((event) => event.eventId));
          const accepted = new Set(ack.acceptedClientIds as string[]);
          if ([...accepted].some((id) => !expected.has(id)))
            throw new Error("Tracki response acknowledged unknown event ids");
          const before = item.batch.events.length;
          const remaining = item.batch.events.filter((event) => !accepted.has(event.eventId ?? ""));
          if (remaining.length === before)
            throw new Error("Tracki response acknowledged no events");
          const afterAck = this.buffer.flatMap((entry) =>
            entry === item
              ? remaining.length
                ? [{ ...entry, batch: { ...entry.batch, events: remaining } }]
                : []
              : [entry],
          );
          // Do not discard the in-memory batch unless its acknowledgment is durable.
          await this.persist(JSON.stringify(afterAck));
          if (generation !== this.generation || this.disposed) break;
          item.batch.events = remaining;
          if (!remaining.length) this.buffer = this.buffer.filter((entry) => entry !== item);
          await this.persist();
          this.failures = 0;
          try {
            this.onResponse?.(data);
          } catch {
            /* UI response handlers are isolated. */
          }
        } catch {
          this.failures++;
          break;
        }
      }
    })().finally(() => {
      this.running = false;
      this.schedule(this.retryDelay());
    });
    return this.inflight;
  }

  /** Policy changes remove no-longer-permitted events before another delivery. */
  async applyPolicy(): Promise<void> {
    this.generation++;
    this.cancelTimer();
    this.prune();
    for (const item of this.buffer)
      item.batch.events = item.batch.events.filter((event) => this.allowed(event));
    this.buffer = this.buffer.filter((item) => item.batch.events.length > 0);
    await this.persist();
    this.schedule(FLUSH_INTERVAL_MS);
  }
  async clear(): Promise<void> {
    this.generation++;
    this.cancelTimer();
    this.buffer = [];
    this.failures = 0;
    await this.persist();
    this.cancelTimer();
  }
  /** Resume only envelopes already bound to the freshly verified merchant scope. */
  async reconcileScope(): Promise<void> {
    this.generation++;
    this.cancelTimer();
    this.buffer = this.buffer.filter((item) => item.batch.scopeTag === this.options.scopeTag?.());
    this.prune();
    await this.persist();
    this.schedule(FLUSH_INTERVAL_MS);
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.cancelTimer();
  }
  get size(): number {
    return this.buffer.reduce((count, item) => count + item.batch.events.length, 0);
  }
  health(): { queuedEvents: number; consecutiveFailures: number; persistenceHealthy: boolean } {
    return {
      queuedEvents: this.size,
      consecutiveFailures: this.failures,
      persistenceHealthy: this.persistenceHealthy,
    };
  }
}
