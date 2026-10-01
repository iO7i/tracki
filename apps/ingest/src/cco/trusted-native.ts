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

/** Only the app SERVER producer may send native batches. Native public keys never assert account identity. */
export function parseTrustedNative(
  value: unknown,
  project: Project,
  now = Date.now(),
): {
  batch: EventBatch;
  scope: TrustedBrowserScope;
  build: ReturnType<typeof nativeBuild>;
} {
  const body = object(value);
  const binding = object(body.binding);
  const raw = object(body.batch);
  const authorizedAt = integer(body.authorizedAt, now - 23 * 3600000, now + 120000);
  // A durable server outbox may deliver after grant expiry. Validate the grant
  // against the recorded authorization time, not this later collector clock.
  const validFrom = integer(binding.validFrom, authorizedAt - 24 * 3600000, authorizedAt + 120000);
  const expiresAt = integer(binding.expiresAt, authorizedAt, authorizedAt + 16 * 60000);
  const allowed = capturePolicy(binding.capturePolicy);
  if (binding.actorKind !== "human") throw new CcoError("native_human_binding_required");
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
  return { batch: parsed.data, scope, build: nativeBuild(raw.build) };
}
export async function acceptTrustedNative(
  value: unknown,
  project: Project,
  accept: (events: StoredEvent[], scope: TrustedBrowserScope) => Promise<unknown> = (
    events,
    scope,
  ) => acceptEvents(events, pg(), scope),
) {
  const now = Date.now();
  const parsed = parseTrustedNative(value, project, now);
  const normalized = normalizeBatch(parsed.batch, project, "cco-native", now, parsed.batch.sentAt);
  for (const event of normalized) {
    // This allowlisted metadata is diagnostic; never account authority or executable replay input.
    event.props = JSON.stringify({ ...JSON.parse(event.props), ccoBuild: parsed.build });
  }
  await accept(normalized, parsed.scope);
  return { acceptedClientIds: parsed.batch.events.map((e) => e.eventId) };
}
