import { type EventBatch, type StoredEvent, eventBatchSchema } from "@tracki/shared";
import {
  capturePolicy,
  isMobileDiagnostic,
  nativeBuild,
  sanitizeMobileEvent,
} from "@tracki/shared/mobile-diagnostics";
import { acceptEvents } from "../inbox";
import { normalizeBatch } from "../normalize";
import { pg } from "../pg";
import type { Project } from "./config";
import { CcoError, correlationId, id, integer, object } from "./contract";
import type { TrustedBrowserScope } from "./trusted-browser";
import {
  nativeHealth,
  nativeProtocol,
  operationCorrelation,
  type NativeProtocol,
  type NativeHealth,
} from "./native-meta";
import { acceptNativeMetadata, type NativeAcceptanceMetadata } from "./native-store";

/** Only the app SERVER producer may send native batches. Native public keys never assert account identity. */
export function parseTrustedNative(
  value: unknown,
  project: Project,
  now = Date.now(),
): {
  batch: EventBatch;
  scope: TrustedBrowserScope;
  build: ReturnType<typeof nativeBuild>;
  protocol: NativeProtocol;
  health: NativeHealth | null;
  eventMetadata: Array<{
    correlation: ReturnType<typeof operationCorrelation>;
    sampleRate?: number;
    fingerprint?: string;
  }>;
} {
  const body = object(value);
  const binding = object(body.binding);
  const raw = object(body.batch);
  const protocol = nativeProtocol(raw.protocol);
  const authorizedAt = integer(body.authorizedAt, now - 23 * 3600000, now + 120000);
  // A durable server outbox may deliver after grant expiry. Validate the grant
  // against the recorded authorization time, not this later collector clock.
  const validFrom = integer(binding.validFrom, authorizedAt - 24 * 3600000, authorizedAt + 120000);
  const expiresAt = integer(binding.expiresAt, authorizedAt, authorizedAt + 16 * 60000);
  const allowed = capturePolicy(binding.capturePolicy);
  if (binding.actorKind !== "human") throw new CcoError("native_human_binding_required");
  if (binding.targetAppKey != null && binding.targetAppKey !== project.appKey)
    throw new CcoError("native_environment_mismatch", 403);
  if (
    correlationId(binding.anonId) !== raw.anonId ||
    correlationId(binding.sessionId) !== raw.sessionId
  )
    throw new CcoError("native_binding_mismatch", 409);
  if (typeof raw.scopeTag !== "string" || !/^[a-f0-9]{64}$/.test(raw.scopeTag))
    throw new CcoError("native_scope_required");
  const scope = {
    orgId: project.orgId,
    projectId: project.projectId,
    accountId: id(binding.accountId),
    installationId: binding.installationId == null ? null : id(binding.installationId),
    generation: binding.generation == null ? null : integer(binding.generation),
  };
  if (!Array.isArray(raw.events) || !raw.events.length || raw.events.length > 50)
    throw new CcoError("invalid_native_batch");
  const events = raw.events.map((input) => {
    const rawEvent = object(input);
    const event = sanitizeMobileEvent(
      rawEvent as unknown as Parameters<typeof sanitizeMobileEvent>[0],
    );
    if (
      !event?.eventId ||
      event.ts < validFrom ||
      event.ts >= expiresAt ||
      event.ts > authorizedAt + 120000
    )
      throw new CcoError("invalid_native_event");
    if (!(isMobileDiagnostic(event) ? allowed.diagnostics : allowed.activity))
      throw new CcoError("native_capture_disabled", 403);
    return event;
  });
  if (new Set(events.map((e) => e.eventId)).size !== events.length)
    throw new CcoError("duplicate_native_event");
  const device = object(raw.device);
  if (!["ios", "android"].includes(String(device.platform)) || device.sdk !== "react-native")
    throw new CcoError("invalid_native_platform");
  const metadata = (value: unknown) =>
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,31}$/.test(value)
      ? value
      : undefined;
  const parsed = eventBatchSchema.safeParse({
    key: "cco_server_verified",
    anonId: raw.anonId,
    sessionId: raw.sessionId,
    sentAt: raw.sentAt,
    events,
    device: {
      platform: device.platform,
      sdk: "react-native",
      osVersion: metadata(device.osVersion),
      appVersion: metadata(device.appVersion),
    },
  });
  if (!parsed.success) throw new CcoError("invalid_native_batch");
  const health =
    raw.health == null
      ? null
      : allowed.diagnostics
        ? nativeHealth(raw.health, authorizedAt)
        : (() => {
            throw new CcoError("native_capture_disabled", 403);
          })();
  if (health && !protocol.capabilities.includes("capture-health-v1"))
    throw new CcoError("unsupported_native_capability", 422);
  if (health && (health.observedAt < validFrom || health.observedAt >= expiresAt))
    throw new CcoError("invalid_native_health_time");
  return {
    batch: parsed.data,
    scope,
    build: nativeBuild(raw.build),
    protocol,
    health,
    eventMetadata: events.map((e) => ({
      correlation: operationCorrelation(e.correlation, true),
      sampleRate: e.sampleRate,
      fingerprint: e.fingerprint,
    })),
  };
}
export async function acceptTrustedNative(
  value: unknown,
  project: Project,
  accept: (
    events: StoredEvent[],
    scope: TrustedBrowserScope,
    metadata: NativeAcceptanceMetadata,
  ) => Promise<unknown> = (events, scope, metadata) => acceptEvents(events, pg(), scope, metadata),
) {
  const now = Date.now();
  const parsed = parseTrustedNative(value, project, now);
  const normalized = normalizeBatch(parsed.batch, project, "cco-native", now, parsed.batch.sentAt);
  for (const [index, event] of normalized.entries()) {
    // This allowlisted metadata is diagnostic; never account authority or executable replay input.
    event.props = JSON.stringify({
      ...JSON.parse(event.props),
      ccoBuild: parsed.build,
      ccoProtocol: parsed.protocol,
      ccoCorrelation: parsed.eventMetadata[index]?.correlation,
      ccoSampleRate: parsed.eventMetadata[index]?.sampleRate,
      ccoFingerprint: parsed.eventMetadata[index]?.fingerprint,
    });
  }
  const raw = object(object(value).batch);
  await accept(normalized, parsed.scope, {
    project,
    anonId: parsed.batch.anonId,
    sessionId: parsed.batch.sessionId,
    scopeTag: String(raw.scopeTag),
    protocol: parsed.protocol,
    build: parsed.build,
    health: parsed.health,
    firstSeen: Math.min(...parsed.batch.events.map((e) => e.ts)),
    lastSeen: Math.max(...parsed.batch.events.map((e) => e.ts)),
    receivedAt: now,
  });
  return { acceptedClientIds: parsed.batch.events.map((e) => e.eventId) };
}
export async function acceptTrustedNativeHealth(
  value: unknown,
  project: Project,
  sql = pg(),
  now = Date.now(),
) {
  const body = object(value),
    binding = object(body.binding),
    raw = object(body.report);
  const authorizedAt = integer(body.authorizedAt, now - 23 * 3600000, now + 120000);
  const validFrom = integer(binding.validFrom, authorizedAt - 24 * 3600000, authorizedAt + 120000),
    expiresAt = integer(binding.expiresAt, authorizedAt, authorizedAt + 16 * 60000);
  if (binding.actorKind !== "human" || !capturePolicy(binding.capturePolicy).diagnostics)
    throw new CcoError("native_capture_disabled", 403);
  if (binding.targetAppKey != null && binding.targetAppKey !== project.appKey)
    throw new CcoError("native_environment_mismatch", 403);
  const anonId = correlationId(raw.anonId),
    sessionId = correlationId(raw.sessionId);
  if (
    anonId !== binding.anonId ||
    sessionId !== binding.sessionId ||
    typeof raw.scopeTag !== "string" ||
    !/^[a-f0-9]{64}$/.test(raw.scopeTag)
  )
    throw new CcoError("native_binding_mismatch", 409);
  const protocol = nativeProtocol(raw.protocol);
  if (!protocol.capabilities.includes("capture-health-v1"))
    throw new CcoError("unsupported_native_capability", 422);
  const health = nativeHealth(raw.health, authorizedAt);
  if (health.observedAt < validFrom || health.observedAt >= expiresAt)
    throw new CcoError("invalid_native_health_time");
  const scope: TrustedBrowserScope = {
    orgId: project.orgId,
    projectId: project.projectId,
    accountId: id(binding.accountId),
    installationId: binding.installationId == null ? null : id(binding.installationId),
    generation: binding.generation == null ? null : integer(binding.generation),
  };
  await sql.begin(async (tx) =>
    acceptNativeMetadata(tx, scope, {
      project,
      anonId,
      sessionId,
      scopeTag: raw.scopeTag as string,
      protocol,
      build: nativeBuild(raw.build),
      health,
      firstSeen: health.observedAt,
      lastSeen: health.observedAt,
      receivedAt: now,
    }),
  );
  return { acceptedHealth: { reporterId: health.reporterId, revision: health.revision } };
}
