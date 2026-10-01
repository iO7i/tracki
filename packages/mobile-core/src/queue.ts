import {
  nativeBuild,
  sanitizeMobileEvent,
  sanitizeNativeHealth,
} from "@tracki/shared/mobile-diagnostics";
import { type Identity, defaultIdFactory } from "./identity";
import {
  type CollectionBudget,
  collectionBudget,
  deliveryCategory,
  isPermanentCategory,
  nativeProtocol,
  utf8Bytes,
} from "./reliability";
import type {
  Batch,
  BuildIdentity,
  Clock,
  DeviceInfo,
  EventInput,
  KeyValueStorage,
  MobileHealthSnapshot,
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
  budget?: Partial<CollectionBudget>;
  random?: () => number;
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
  private readonly budget: CollectionBudget;
  private healthHandler?: (health: MobileHealthSnapshot) => void;
  private stats: MobileHealthSnapshot;
  private healthScope?: string;
  private healthWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private persistHealthSoon(): void {
    if (this.healthWriteTimer || this.disposed) return;
    this.healthWriteTimer = setTimeout(() => {
      this.healthWriteTimer = null;
      void this.persist().catch(() => {});
    }, 1000);
    (this.healthWriteTimer as { unref?: () => void }).unref?.();
  }
  private cancelHealthWrite(): void {
    if (this.healthWriteTimer) clearTimeout(this.healthWriteTimer);
    this.healthWriteTimer = null;
  }

  private newStats(): MobileHealthSnapshot {
    const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    const reporterId =
      crypto?.randomUUID?.() ??
      Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    return {
      reporterId,
      revision: 1,
      observedAt: this.now(),
      observed: 0,
      sampledOut: 0,
      droppedCapacity: 0,
      droppedExpired: 0,
      rejected: 0,
      storageFailures: 0,
      unsupportedSchema: 0,
      accepted: 0,
      queueDepth: 0,
      queueBytes: 0,
      retryingCount: 0,
      lastResponseCategory: "none",
      routineSuccessSampleRate: this.budget.routineSuccessSampleRate,
    };
  }
  private changed(): void {
    this.stats.revision = Math.min(1e9, this.stats.revision + 1);
    this.stats.observedAt = this.now();
    this.stats.queueDepth = this.size;
    this.stats.queueBytes = utf8Bytes(JSON.stringify(this.buffer));
    this.stats.retryingCount = this.failures ? this.size : 0;
    const oldest = this.buffer.flatMap((item) => item.batch.events.map((event) => event.ts));
    this.stats.oldestQueuedAt = oldest.length ? Math.min(...oldest) : undefined;
    for (const key of [
      "observed",
      "sampledOut",
      "droppedCapacity",
      "droppedExpired",
      "rejected",
      "storageFailures",
      "unsupportedSchema",
      "accepted",
    ] as const)
      this.stats[key] = Math.min(1e9, this.stats[key]);
  }
  setHealthHandler(handler?: (health: MobileHealthSnapshot) => void): void {
    this.healthHandler = handler;
  }
  async refreshHealth(): Promise<MobileHealthSnapshot> {
    this.changed();
    await this.persist();
    return { ...this.stats };
  }
  async recordDeliveryResult(error?: unknown): Promise<void> {
    this.stats.lastAttemptAt = this.now();
    this.stats.lastResponseCategory = error === undefined ? "accepted" : deliveryCategory(error);
    if (error === undefined) this.stats.lastSuccessAt = this.now();
    this.changed();
    await this.persist().catch(() => {});
  }
  healthSnapshot(): MobileHealthSnapshot {
    return { ...this.stats };
  }
  private notifyHealth(): void {
    try {
      this.healthHandler?.(this.healthSnapshot());
    } catch {
      /* Host observer cannot affect delivery. */
    }
  }

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
    this.budget = collectionBudget(options.budget);
    this.stats = this.newStats();
  }

  async hydrate(): Promise<void> {
    if (!this.options.storage) return;
    let raw: string | null;
    try {
      raw = await this.options.storage.get(this.storageKey);
    } catch {
      this.persistenceHealthy = false;
      this.stats.storageFailures++;
      this.stats.lastResponseCategory = "local_storage_failure";
      this.changed();
      return; // Collection fails closed; app initialization remains available.
    }
    try {
      const stored: unknown = raw && utf8Bytes(raw) <= MAX_QUEUE_BYTES * 3 ? JSON.parse(raw) : [];
      const document =
        stored && typeof stored === "object" && !Array.isArray(stored)
          ? (stored as Record<string, unknown>)
          : null;
      const restored = sanitizeNativeHealth(document?.health);
      if (restored) {
        this.stats = restored;
        this.healthScope = typeof document?.scopeTag === "string" ? document.scopeTag : undefined;
      }
      const parsed: unknown = Array.isArray(stored) ? stored : document?.buffer;
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
          if (
            b.protocol &&
            (![1, 2].includes(b.protocol.schemaVersion) ||
              typeof b.protocol.sdkVersion !== "string" ||
              !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(b.protocol.sdkVersion) ||
              !Array.isArray(b.protocol.capabilities) ||
              b.protocol.capabilities.length > 16 ||
              (b.protocol.requiredCapabilities !== undefined &&
                (!Array.isArray(b.protocol.requiredCapabilities) ||
                  b.protocol.requiredCapabilities.length > 16)))
          ) {
            this.stats.unsupportedSchema += b.events.length;
            this.stats.rejected += b.events.length;
            this.stats.lastResponseCategory = "unsupported_schema";
            continue;
          }
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
                // Retain the protocol of the binary which created the evidence.
                protocol: b.protocol
                  ? {
                      sdkVersion: b.protocol.sdkVersion,
                      schemaVersion: b.protocol.schemaVersion,
                      capabilities: b.protocol.capabilities
                        .filter(
                          (value) => typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value),
                        )
                        .slice(0, 16),
                      requiredCapabilities: b.protocol.requiredCapabilities
                        ?.filter(
                          (value) => typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value),
                        )
                        .slice(0, 16),
                    }
                  : undefined,
                events,
              },
              sealed: true,
            });
          }
        }
      }
    } catch {
      this.stats.storageFailures++;
      this.stats.lastResponseCategory = "local_storage_failure";
      this.changed();
    }
    this.prune();
    await this.persist().catch(() => {});
    if (this.deliverable()) this.schedule(FLUSH_INTERVAL_MS);
  }

  private allowed(event: EventInput): boolean {
    return this.options.allowed?.(event) ?? true;
  }
  private batchBytes(batch: Batch): number {
    return utf8Bytes(JSON.stringify({ ...batch, health: this.healthSnapshot() }));
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
    if (safe && !this.allowed(safe)) return;
    this.stats.observed++;
    if (!safe || safe.ts < this.now() - this.budget.eventTtlMs || safe.ts > this.now() + 60000) {
      this.stats.rejected++;
      this.changed();
      this.persistHealthSoon();
      this.notifyHealth();
      return;
    }
    const routine =
      safe.type === "track" &&
      safe.props?.name === "cco_response" &&
      typeof safe.props.statusCode === "number" &&
      safe.props.statusCode < 400 &&
      safe.props.ok !== false &&
      (typeof safe.props.durationMs !== "number" ||
        safe.props.durationMs < this.budget.unusualLatencyMs);
    safe.sampleRate = routine ? this.budget.routineSuccessSampleRate : 1;
    if (routine && (this.options.random ?? Math.random)() >= this.budget.routineSuccessSampleRate) {
      this.stats.sampledOut++;
      this.changed();
      this.persistHealthSoon();
      this.notifyHealth();
      return;
    }
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
      tail.batch.events.length >= this.budget.batchSize ||
      this.batchBytes({ ...tail.batch, events: [...tail.batch.events, identified] }) >
        this.budget.batchByteLimit ||
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
          protocol: { ...nativeProtocol, capabilities: [...nativeProtocol.capabilities] },
        },
        sealed: false,
      };
      this.buffer.push(tail);
    }
    tail.batch.events.push(identified);
    if (this.batchBytes(tail.batch) > this.budget.batchByteLimit) {
      tail.batch.events.pop();
      this.stats.rejected++;
      this.stats.lastResponseCategory = "payload_too_large";
    }
    this.healthScope = scopeTag;
    this.prune();
    this.changed();
    void this.persist()
      .then(() => this.notifyHealth())
      .catch(() => {});
    if (this.size >= FLUSH_SIZE && this.failures === 0) void this.flush();
    else this.schedule(this.retryDelay());
  }

  private retryDelay(): number {
    return Math.min(
      5 * 60 * 1000,
      FLUSH_INTERVAL_MS *
        2 ** Math.min(this.failures, 6) *
        (this.failures ? 0.75 + (this.options.random ?? Math.random)() * 0.5 : 1),
    );
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
    const cutoff = this.now() - this.budget.eventTtlMs;
    const before = this.size;
    this.buffer = this.buffer.filter(
      (item) => item.batch.sentAt >= cutoff && item.batch.sentAt <= this.now() + 60_000,
    );
    for (const item of this.buffer)
      item.batch.events = item.batch.events.filter((event) => event.ts >= cutoff);
    this.buffer = this.buffer.filter((item) => item.batch.events.length > 0);
    this.stats.droppedExpired += before - this.size;
    while (
      this.size > this.budget.maxQueuedEvents ||
      utf8Bytes(JSON.stringify(this.buffer)) > this.budget.maxQueuedBytes
    ) {
      // Preserve failures before routine successful request evidence, even when
      // an outage fills the outbox. Never modify an already submitted payload.
      const routine = this.buffer.find((item) =>
        item.batch.events.some(
          (event) =>
            event.type === "track" &&
            event.props?.name === "cco_response" &&
            typeof event.props.statusCode === "number" &&
            event.props.statusCode < 400 &&
            (typeof event.props.durationMs !== "number" ||
              event.props.durationMs < this.budget.unusualLatencyMs),
        ),
      );
      if (routine) {
        const index = routine.batch.events.findIndex(
          (event) =>
            event.type === "track" &&
            event.props?.name === "cco_response" &&
            typeof event.props.statusCode === "number" &&
            event.props.statusCode < 400 &&
            (typeof event.props.durationMs !== "number" ||
              event.props.durationMs < this.budget.unusualLatencyMs),
        );
        routine.batch.events.splice(index, 1);
        this.stats.droppedCapacity++;
        this.buffer = this.buffer.filter((item) => item.batch.events.length > 0);
      } else this.stats.droppedCapacity += this.buffer.shift()?.batch.events.length ?? 0;
    }
    if (before !== this.size) this.changed();
  }
  private persist(snapshot = JSON.stringify(this.buffer)): Promise<void> {
    this.cancelHealthWrite();
    const generation = this.generation;
    const buffer = JSON.parse(snapshot) as StoredBatch[];
    const timestamps = buffer.flatMap((item) => item.batch.events.map((event) => event.ts));
    const health = {
      ...this.stats,
      queueDepth: timestamps.length,
      queueBytes: utf8Bytes(snapshot),
      retryingCount: this.failures ? timestamps.length : 0,
      oldestQueuedAt: timestamps.length ? Math.min(...timestamps) : undefined,
    };
    const document = JSON.stringify({ version: 2, buffer, scopeTag: this.healthScope, health });
    this.writes = this.writes
      .catch(() => undefined)
      .then(async () => {
        try {
          if (!this.options.storage) throw new Error("Tracki queue requires durable storage");
          await this.options.storage.set(this.storageKey, document);
          this.persistenceHealthy = true;
        } catch (error) {
          if (generation === this.generation && !this.disposed) {
            this.persistenceHealthy = false;
            this.stats.storageFailures++;
            this.stats.lastResponseCategory = "local_storage_failure";
            this.changed();
          }
          throw Object.assign(new Error("Tracki durable storage unavailable"), {
            code: "secure-storage-unavailable",
          });
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
      // Health-only sampling counters are flushed at lifecycle boundaries even
      // when no event survived sampling. Routine observations coalesce ≤1s.
      if (!this.buffer.length) {
        await this.persist().catch(() => {});
        return;
      }
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
        this.stats.lastAttemptAt = this.now();
        this.changed();
        payload.health = this.healthSnapshot();
        if (utf8Bytes(JSON.stringify(payload)) > this.budget.batchByteLimit) {
          // Persisted legacy or grown health metadata must still respect this
          // client's current wire budget. Preserve an explicit loss reason.
          this.stats.rejected += item.batch.events.length;
          this.stats.lastResponseCategory = "payload_too_large";
          this.buffer = this.buffer.filter((entry) => entry !== item);
          this.changed();
          await this.persist().catch(() => {});
          continue;
        }
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
            throw Object.assign(new Error("Tracki invalid receipt"), { code: "invalid-ack" });
          }
          const expected = new Set(payload.events.map((event) => event.eventId));
          const accepted = new Set(ack.acceptedClientIds as string[]);
          if ([...accepted].some((id) => !expected.has(id)))
            throw Object.assign(new Error("Tracki invalid receipt"), { code: "invalid-ack" });
          const before = item.batch.events.length;
          const remaining = item.batch.events.filter((event) => !accepted.has(event.eventId ?? ""));
          if (remaining.length === before)
            throw Object.assign(new Error("Tracki invalid receipt"), { code: "invalid-ack" });
          const afterAck = this.buffer.flatMap((entry) =>
            entry === item
              ? remaining.length
                ? [{ ...entry, batch: { ...entry.batch, events: remaining } }]
                : []
              : [entry],
          );
          // Do not discard the in-memory batch unless its acknowledgment is durable.
          const previousStats = { ...this.stats };
          this.stats.accepted += accepted.size;
          this.stats.lastSuccessAt = this.now();
          this.stats.lastResponseCategory = "accepted";
          this.changed();
          try {
            await this.persist(JSON.stringify(afterAck));
          } catch (error) {
            if (generation === this.generation && !this.disposed) {
              const failures = this.stats.storageFailures;
              this.stats = previousStats;
              this.stats.storageFailures = failures;
              this.changed();
            }
            throw error;
          }
          if (generation !== this.generation || this.disposed) break;
          item.batch.events = remaining;
          if (!remaining.length) this.buffer = this.buffer.filter((entry) => entry !== item);
          await this.persist();
          this.failures = 0;
          this.changed();
          try {
            this.onResponse?.(data);
          } catch {
            /* UI response handlers are isolated. */
          }
        } catch (error) {
          if (generation !== this.generation || this.disposed) break;
          const category = deliveryCategory(error);
          this.stats.lastResponseCategory = category;
          if (isPermanentCategory(category)) {
            const count = this.buffer.includes(item) ? item.batch.events.length : 0;
            this.stats.rejected += count;
            if (category === "unsupported_schema") this.stats.unsupportedSchema += count;
            if (category === "expired") this.stats.droppedExpired += count;
            this.buffer = this.buffer.filter((entry) => entry !== item);
            this.failures = 0;
            this.changed();
            await this.persist().catch(() => {});
            continue;
          }
          this.failures++;
          this.changed();
          await this.persist().catch(() => {});
          break;
        }
      }
    })().finally(() => {
      this.running = false;
      this.notifyHealth();
      this.schedule(this.retryDelay());
    });
    return this.inflight;
  }

  /** Policy changes remove no-longer-permitted events before another delivery. */
  async applyPolicy(): Promise<void> {
    this.generation++;
    this.cancelTimer();
    this.prune();
    const before = this.size;
    for (const item of this.buffer)
      item.batch.events = item.batch.events.filter((event) => this.allowed(event));
    this.buffer = this.buffer.filter((item) => item.batch.events.length > 0);
    this.stats.rejected += before - this.size;
    this.changed();
    await this.persist();
    this.schedule(FLUSH_INTERVAL_MS);
  }
  async clear(): Promise<void> {
    this.generation++;
    this.cancelTimer();
    this.buffer = [];
    this.failures = 0;
    this.stats = this.newStats();
    this.healthScope = undefined;
    await this.persist();
    this.cancelTimer();
  }
  /** Resume only envelopes already bound to the freshly verified merchant scope. */
  async reconcileScope(): Promise<void> {
    this.generation++;
    this.cancelTimer();
    if (this.healthScope && this.healthScope !== this.options.scopeTag?.())
      this.stats = this.newStats();
    this.healthScope = this.options.scopeTag?.();
    this.buffer = this.buffer.filter((item) => item.batch.scopeTag === this.options.scopeTag?.());
    this.prune();
    this.changed();
    await this.persist();
    this.schedule(FLUSH_INTERVAL_MS);
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.cancelTimer();
    this.cancelHealthWrite();
    this.healthHandler = undefined;
  }
  get size(): number {
    return this.buffer.reduce((count, item) => count + item.batch.events.length, 0);
  }
  health(): MobileHealthSnapshot & {
    queuedEvents: number;
    consecutiveFailures: number;
    persistenceHealthy: boolean;
  } {
    return {
      ...this.healthSnapshot(),
      queuedEvents: this.size,
      consecutiveFailures: this.failures,
      persistenceHealthy: this.persistenceHealthy,
    };
  }
}
