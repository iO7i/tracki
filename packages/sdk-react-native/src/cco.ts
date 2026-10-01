import { nativeProtocol, utf8Bytes, type Batch, type BuildIdentity, type KeyValueStorage, type NativeCorrelation, type TrackiClient, type Transport } from "@io7i/tracki-mobile-core";
import { nativeOpaqueId, nativeResponseCategories, safeNativeRoute, sanitizeNativeCorrelation } from "@tracki/shared/mobile-diagnostics";

type CapturePolicy = { diagnostics: boolean; activity: boolean };
type Grant = {
  token: string;
  scopeTag: string;
  expiresAt: number;
  anonId: string;
  sessionId: string;
  capturePolicy: CapturePolicy;
};

export interface CcoNativeBridgeOptions {
  /** The app backend, never the collector or a producer/signing credential. */
  apiOrigin: string;
  nativePrefix?: string;
  /** Return the app's current complete Authorization header, or null when signed out. */
  getAuthorization(): Promise<string | null>;
  /** Encrypt grants at rest, for example with an Expo SecureStore adapter. */
  grantStorage: KeyValueStorage;
  /** Unique to this app, environment and authenticated store context. */
  namespace: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  clock?: () => number;
  /** Generate random W3C identifiers with a cryptographic source (e.g. Expo Crypto). */
  createTraceContext?: () => { traceId: string; spanId: string };
  build?: BuildIdentity;
  /** Bounded metadata heartbeat, between 1 and 15 minutes; default 5 minutes. */
  healthIntervalMs?: number;
}

export interface CcoNativeBridge {
  transport: Transport;
  /** Instrument backend status/timing only. Never reads request/response bodies. */
  tracedFetch: typeof globalThis.fetch;
  /** Explicitly connect after login/store selection, before collection starts. */
  connect(client: TrackiClient): Promise<void>;
  refresh(client: TrackiClient): Promise<void>;
  /** Bounded health-only report; no synthetic event or recursive instrumentation. */
  reportHealth(): Promise<void>;
  /** Call before logout or switching accounts/stores. */
  reset(client: TrackiClient): Promise<void>;
  dispose(): void;
}

/** Deliberately contains no response body, token, input, or authorization value. */
export class CcoNativeBridgeError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(`CCO native bridge: ${code}`);
    this.name = "CcoNativeBridgeError";
  }
}

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_GRANTS = 64;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value);
const scopeIdentifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const storagePart = (value: string): string => value.replace(/_/g, "_u_").replace(/:/g, "_c_");

/** Event-only bridge. There is no view, input, screenshot, touch, or recording adapter. */
export async function createCcoNativeBridge(
  options: CcoNativeBridgeOptions,
): Promise<CcoNativeBridge> {
  const origin = new URL(options.apiOrigin);
  const loopback =
    origin.hostname === "localhost" ||
    origin.hostname === "127.0.0.1" ||
    origin.hostname === "[::1]";
  if (
    (origin.protocol !== "https:" && !(loopback && origin.protocol === "http:")) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  ) {
    throw new CcoNativeBridgeError("invalid-api-origin");
  }
  const prefix = options.nativePrefix ?? "/api/cco/native";
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(prefix) || !identifier(options.namespace)) {
    throw new CcoNativeBridgeError("invalid-configuration");
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.clock ?? Date.now;
  const timeout = Math.max(1000, Math.min(30000, options.timeoutMs ?? 10000));
  const healthInterval = Math.max(60000, Math.min(900000, options.healthIntervalMs ?? 300000));
  const storageKey = `${storagePart(options.namespace)}.cco.grants`;
  let grants: Grant[] = [];
  let client: TrackiClient | null = null;
  let connectedScope: string | null = null;
  let disposed = false;
  let generation = 0;
  let bootstrapLock: Promise<void> = Promise.resolve();
  let writes: Promise<void> = Promise.resolve();
  let healthTimer: ReturnType<typeof setTimeout> | undefined;
  let healthInFlight: Promise<void> | undefined;
  const controllers = new Set<AbortController>();
  const storedRecords = new Map<string, string>();
  const grantKey = (g: { anonId: string; sessionId: string }): string =>
    `${storageKey}.${storagePart(g.anonId)}.${storagePart(g.sessionId)}`;

  const persist = (): Promise<void> => {
    const snapshot = grants.map((grant) => ({
      grant,
      key: grantKey(grant),
      raw: JSON.stringify(grant),
    }));
    const write = writes
      .catch(() => undefined)
      .then(async () => {
        const remaining = new Set(snapshot.map((g) => g.key));
        for (const key of storedRecords.keys()) {
          if (!remaining.has(key)) {
            if (options.grantStorage.remove) await options.grantStorage.remove(key);
            else await options.grantStorage.set(key, "");
            storedRecords.delete(key);
          }
        }
        for (const record of snapshot) {
          if (storedRecords.get(record.key) !== record.raw) {
            await options.grantStorage.set(record.key, record.raw);
            storedRecords.set(record.key, record.raw);
          }
        }
        // Split the index into small secure-storage values; tokens never share an item.
        const pages = Math.ceil(snapshot.length / 8);
        for (let page = 0; page < 8; page++) {
          await options.grantStorage.set(
            `${storageKey}.index.${page}`,
            page < pages
              ? JSON.stringify(
                  snapshot
                    .slice(page * 8, page * 8 + 8)
                    .map(({ grant }) => ({ anonId: grant.anonId, sessionId: grant.sessionId })),
                )
              : "[]",
          );
        }
        await options.grantStorage.set(`${storageKey}.index`, String(pages));
      });
    writes = write;
    return write.catch(() => {
      throw new CcoNativeBridgeError("secure-storage-unavailable");
    });
  };
  const cancel = (): void => {
    generation++;
    if (healthTimer) clearTimeout(healthTimer);
    healthTimer = undefined;
    for (const controller of controllers) controller.abort();
    controllers.clear();
  };
  const ensureLive = (): void => {
    if (disposed) throw new CcoNativeBridgeError("disposed");
  };
  const suspend = async (): Promise<void> => {
    cancel();
    connectedScope = null;
    grants = [];
    if (client) await client.reset();
    await persist();
  };

  const readPolicy = (value: unknown): CapturePolicy => {
    if (
      !object(value) ||
      typeof value.diagnostics !== "boolean" ||
      typeof value.activity !== "boolean"
    ) {
      throw new CcoNativeBridgeError("invalid-capture-policy");
    }
    return { diagnostics: value.diagnostics, activity: value.activity };
  };
  const parseGrant = (value: unknown, anonId: string, sessionId: string): Grant => {
    if (
      !object(value) ||
      typeof value.token !== "string" ||
      value.token.length < 20 ||
      value.token.length > 4096 ||
      !scopeIdentifier(value.scopeTag)
    )
      throw new CcoNativeBridgeError("invalid-grant");
    const expiresAt = value.expiresAt;
    if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt))
      throw new CcoNativeBridgeError("invalid-grant-expiry");
    return {
      token: value.token,
      scopeTag: value.scopeTag,
      expiresAt,
      anonId,
      sessionId,
      capturePolicy: readPolicy(value.capturePolicy),
    };
  };

  try {
    const pages = Number((await options.grantStorage.get(`${storageKey}.index`)) ?? 0);
    if (!Number.isInteger(pages) || pages < 0 || pages > 8)
      throw new CcoNativeBridgeError("invalid-secure-storage-index");
    for (let page = 0; page < pages; page++) {
      const rawIndex = await options.grantStorage.get(`${storageKey}.index.${page}`);
      if (!rawIndex || rawIndex.length > 4096) continue;
      const index: unknown = JSON.parse(rawIndex);
      if (!Array.isArray(index) || index.length > 8) continue;
      for (const entry of index) {
        if (!object(entry) || !identifier(entry.anonId) || !identifier(entry.sessionId)) continue;
        const key = grantKey({ anonId: entry.anonId, sessionId: entry.sessionId });
        const raw = await options.grantStorage.get(key);
        if (!raw || raw.length > 8192) continue;
        try {
          grants.push(parseGrant(JSON.parse(raw), entry.anonId, entry.sessionId));
          storedRecords.set(key, raw);
        } catch {
          /* Malformed grants cannot authorize delivery. */
        }
      }
    }
  } catch {
    throw new CcoNativeBridgeError("secure-storage-unavailable");
  }

  const request = async (route: "bootstrap" | "events" | "health", body: unknown): Promise<unknown> => {
    ensureLive();
    const epoch = generation;
    let authorization: string | null;
    try {
      authorization = await options.getAuthorization();
    } catch {
      throw new CcoNativeBridgeError("authentication-unavailable");
    }
    if (epoch !== generation || disposed) throw new CcoNativeBridgeError("cancelled");
    if (!authorization || !/^Bearer [^\s\r\n]+$/.test(authorization)) {
      await suspend();
      throw new CcoNativeBridgeError("authentication-required");
    }
    const payload = JSON.stringify(body);
    if (utf8Bytes(payload) > 128 * 1024) throw new CcoNativeBridgeError("batch-too-large");
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetcher(`${origin.origin}${prefix}/${route}`, {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: payload,
        // RN and Node publish overlapping ambient AbortSignal declarations;
        // both implementations accept the standard AbortController signal.
        signal: controller.signal as NonNullable<Parameters<typeof fetcher>[1]>["signal"],
        redirect: "error",
      });
      if (epoch !== generation || disposed) throw new CcoNativeBridgeError("cancelled");
      if (!response.ok) {
        const rejection = response.headers.get("x-cco-rejection");
        if ([401, 403, 409, 410].includes(response.status)) await suspend();
        throw new CcoNativeBridgeError(rejection && nativeResponseCategories.includes(rejection as typeof nativeResponseCategories[number]) && rejection !== "accepted" && rejection !== "none" ? rejection : "http-error", response.status);
      }
      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES)
        throw new CcoNativeBridgeError("response-too-large");
      let text = "";
      if (response.body?.getReader && typeof TextDecoder !== "undefined") {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) {
              await reader.cancel();
              throw new CcoNativeBridgeError("response-too-large");
            }
            text += decoder.decode(chunk.value, { stream: true });
          }
          text += decoder.decode();
        } finally {
          reader.releaseLock();
        }
      } else {
        // React Native's fetch commonly has no streaming response body.
        text = await response.text();
        if (text.length > MAX_RESPONSE_BYTES) throw new CcoNativeBridgeError("response-too-large");
      }
      if (epoch !== generation || disposed) throw new CcoNativeBridgeError("cancelled");
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new CcoNativeBridgeError("invalid-response");
      }
    } catch (error) {
      if (error instanceof CcoNativeBridgeError) throw error;
      throw new CcoNativeBridgeError(
        controller.signal.aborted ? "cancelled-or-timeout" : "network-error",
      );
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  };

  const bootstrap = async (anonId: string, sessionId: string, previous?: Grant): Promise<Grant> => {
    if (!identifier(anonId) || !identifier(sessionId))
      throw new CcoNativeBridgeError("invalid-identity");
    const epoch = generation;
    const value = await request("bootstrap", {
      anonId,
      sessionId,
      protocol: nativeProtocol,
      ...(previous ? { previousToken: previous.token } : {}),
    });
    const grant = parseGrant(value, anonId, sessionId);
    if (grant.expiresAt <= now() || grant.expiresAt > now() + 16 * 60 * 1000)
      throw new CcoNativeBridgeError("invalid-grant-expiry");
    if (
      (previous && grant.scopeTag !== previous.scopeTag) ||
      (connectedScope && grant.scopeTag !== connectedScope)
    ) {
      await suspend();
      throw new CcoNativeBridgeError("authority-changed-reconnect-required");
    }
    if (!grant.capturePolicy.activity && !grant.capturePolicy.diagnostics) {
      await suspend();
      throw new CcoNativeBridgeError("capture-disabled");
    }
    if (epoch !== generation || disposed) throw new CcoNativeBridgeError("cancelled");
    grants = [
      grant,
      ...grants.filter((g) => g.anonId !== anonId || g.sessionId !== sessionId),
    ].slice(0, MAX_GRANTS);
    await persist();
    if (epoch !== generation || disposed) throw new CcoNativeBridgeError("cancelled");
    return grant;
  };
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const epoch = generation;
    const result = bootstrapLock
      .catch(() => undefined)
      .then(() => {
        if (epoch !== generation || disposed) throw new CcoNativeBridgeError("cancelled");
        return run();
      });
    bootstrapLock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const connect = async (target: TrackiClient): Promise<void> =>
    serial(async () => {
      ensureLive();
      const epoch = generation;
      if (client && client !== target) throw new CcoNativeBridgeError("reset-before-client-change");
      client = target;
      if (
        !connectedScope &&
        (target.capturePolicy().activity || target.capturePolicy().diagnostics)
      ) {
        await suspend();
        throw new CcoNativeBridgeError("capture-must-start-disabled");
      }
      const previous =
        grants.find((g) => g.anonId === target.anonId() && g.sessionId === target.sessionId()) ??
        grants.find((g) => g.anonId === target.anonId());
      const grant = await bootstrap(target.anonId(), target.sessionId(), previous);
      const existingScope = target.captureScope();
      if (existingScope && existingScope !== grant.scopeTag) {
        await suspend();
        throw new CcoNativeBridgeError("authority-changed-reconnect-required");
      }
      connectedScope = grant.scopeTag;
      await target.setCaptureScope(grant.scopeTag);
      if (epoch !== generation || disposed || client !== target)
        throw new CcoNativeBridgeError("cancelled");
      target.setTransport(transport);
      await target.setCapturePolicy(grant.capturePolicy);
      if (epoch !== generation || disposed || client !== target)
        throw new CcoNativeBridgeError("cancelled");
      scheduleHealth();
    });

  const reportHealth = (): Promise<void> => {
    if (healthInFlight) return healthInFlight;
    const target = client;
    const epoch = generation;
    if (!target || disposed || !connectedScope || !target.capturePolicy().diagnostics) return Promise.resolve();
    healthInFlight = (async () => {
      let grant = grants.find(g => g.anonId === target.anonId() && g.sessionId === target.sessionId() && g.scopeTag === connectedScope);
      if (!grant) return; // Only connect/event delivery can acquire an identity grant.
      if (grant.expiresAt <= now() + 30000) {
        const previous = grant;
        grant = await serial(() => bootstrap(previous.anonId, previous.sessionId, previous));
      }
      if (epoch !== generation || disposed || client !== target) return;
      const health = await target.refreshDeliveryHealth();
      const receipt = await request("health", { token: grant.token, anonId: target.anonId(), sessionId: target.sessionId(), scopeTag: connectedScope, protocol: nativeProtocol, build: options.build, health });
      if (!object(receipt) || !object(receipt.acceptedHealth) || receipt.acceptedHealth.reporterId !== health.reporterId || receipt.acceptedHealth.revision !== health.revision) throw new CcoNativeBridgeError("invalid-acknowledgment");
      if (epoch === generation && !disposed && client === target) await target.recordDeliveryResult();
    })().catch(async error => {
      if (epoch === generation && !disposed && client === target) await target.recordDeliveryResult(error);
      throw error;
    }).finally(() => { healthInFlight = undefined; });
    return healthInFlight;
  };
  const scheduleHealth = (): void => {
    if (healthTimer || disposed || !client?.capturePolicy().diagnostics || !connectedScope) return;
    healthTimer = setTimeout(() => {
      healthTimer = undefined;
      void reportHealth().catch(() => {}).finally(scheduleHealth);
    }, healthInterval);
    (healthTimer as { unref?: () => void }).unref?.();
  };

  const transport: Transport = {
    async post(url, body) {
      ensureLive();
      if (!/\/(?:v1\/)?events$/.test(url)) throw new CcoNativeBridgeError("unsupported-operation");
      if (
        !client ||
        !connectedScope ||
        !object(body) ||
        !Array.isArray(body.events) ||
        body.events.length > 50 ||
        body.scopeTag !== connectedScope ||
        !identifier(body.anonId) ||
        !identifier(body.sessionId)
      ) {
        throw new CcoNativeBridgeError("unbound-batch");
      }
      const batch = body as unknown as Batch;
      let grant = grants.find(
        (g) =>
          g.anonId === batch.anonId &&
          g.sessionId === batch.sessionId &&
          g.scopeTag === batch.scopeTag,
      );
      if (!grant) {
        // Only the connected client's NEW current session may acquire its first grant.
        // Historical queued batches must already have a stored grant; never rebind them.
        if (batch.anonId !== client.anonId() || batch.sessionId !== client.sessionId())
          throw new CcoNativeBridgeError("unbound-historical-batch");
        const previous = grants.find(
          (g) => g.anonId === batch.anonId && g.scopeTag === connectedScope,
        );
        if (!previous) throw new CcoNativeBridgeError("unbound-batch");
        grant = await serial(() => bootstrap(batch.anonId, batch.sessionId, previous));
      } else if (grant.expiresAt <= now() + 30000) {
        const previous = grant;
        grant = await serial(() => bootstrap(batch.anonId, batch.sessionId, previous));
      }
      const value = await request("events", { token: grant.token, batch });
      if (!object(value) || !Array.isArray(value.acceptedClientIds))
        throw new CcoNativeBridgeError("invalid-acknowledgment");
      const sentIds = new Set(batch.events.map((event) => event.eventId));
      if (
        sentIds.has(undefined) ||
        sentIds.size !== batch.events.length ||
        value.acceptedClientIds.length !== sentIds.size ||
        new Set(value.acceptedClientIds).size !== sentIds.size ||
        value.acceptedClientIds.some((id) => typeof id !== "string" || !sentIds.has(id))
      )
        throw new CcoNativeBridgeError("invalid-acknowledgment");
      return { acceptedClientIds: [...new Set(value.acceptedClientIds)] };
    },
    async get() {
      throw new CcoNativeBridgeError("unsupported-operation");
    },
  };

  const tracedFetch: typeof globalThis.fetch = async (input, init) => {
    let url: URL;
    try {
      url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
    } catch {
      return fetcher(input, init);
    }
    if (
      !client ||
      !client.capturePolicy().diagnostics ||
      !connectedScope ||
      disposed ||
      url.origin !== origin.origin ||
      url.pathname === prefix ||
      url.pathname.startsWith(`${prefix}/`)
    )
      return fetcher(input, init);
    const target = client;
    const epoch = generation;
    const startedAt = now();
    let traceContext: { traceId: string; spanId: string } | undefined;
    const headers = new Headers(
      init?.headers ??
        (typeof input === "object" && "headers" in input ? input.headers : undefined),
    );
    const existingTrace = headers.get("traceparent");
    const existing = existingTrace?.match(
      /^00-((?!0{32}-)[a-f0-9]{32})-((?!0{16}-)[a-f0-9]{16})-[a-f0-9]{2}$/,
    );
    try {
      const candidate =
        existing?.[1] && existing[2]
          ? { traceId: existing[1], spanId: existing[2] }
          : options.createTraceContext?.();
      if (
        candidate &&
        /^(?!0+$)[a-f0-9]{32}$/.test(candidate.traceId) &&
        /^(?!0+$)[a-f0-9]{16}$/.test(candidate.spanId)
      ) {
        traceContext = { traceId: candidate.traceId, spanId: candidate.spanId };
      }
    } catch {
      /* Diagnostics cannot break app requests. */
    }
    const path = safeNativeRoute(url.pathname);
    const suppliedRequestId = nativeOpaqueId(headers.get("x-client-request-id"));
    const clientRequestId = suppliedRequestId ?? traceContext?.spanId;
    let correlation: NativeCorrelation | undefined = clientRequestId ? { clientRequestId, stage: "request", outcomeSource: "client", outcomeState: "unknown" } : undefined;
    const emit = (name: string, statusCode?: number): void => {
      if (epoch !== generation || disposed || client !== target) return;
      try {
        target.diagnostic({
          type: "track",
          ts: now(),
          path,
          traceContext,
          correlation,
          props: {
            name,
            ...(statusCode ? { statusCode } : {}),
            durationMs: Math.max(0, Math.min(86400000, Math.floor(now() - startedAt))),
          },
        });
      } catch {
        /* Never affect the app's network result. */
      }
    };
    emit("cco_request");
    let requestInit = init;
    if (traceContext || clientRequestId) {
      if (traceContext && !existing) headers.set("traceparent", `00-${traceContext.traceId}-${traceContext.spanId}-01`);
      if (clientRequestId) headers.set("x-client-request-id", clientRequestId);
      requestInit = { ...init, headers };
    }
    try {
      const response = await fetcher(input, requestInit);
      correlation = sanitizeNativeCorrelation({ clientRequestId, requestId: response.headers.get("x-request-id"), operationId: response.headers.get("x-operation-id"), jobId: response.headers.get("x-job-id"), stage: "request", outcomeSource: "client", outcomeState: response.ok ? "accepted" : "failed" });
      emit("cco_response", response.status);
      return response;
    } catch (error) {
      emit("cco_network_failure");
      throw error;
    }
  };

  return {
    transport,
    tracedFetch,
    connect,
    refresh: connect,
    reportHealth,
    async reset(target) {
      if (client && client !== target) throw new CcoNativeBridgeError("wrong-client");
      client = target;
      await suspend();
      client = null;
    },
    dispose() {
      disposed = true;
      cancel();
      connectedScope = null;
      // End collection without withdrawing policy or deleting the durable outbox.
      // reset() is the explicit purge boundary for logout/account changes.
      if (client) client.dispose();
      client = null;
    },
  };
}
