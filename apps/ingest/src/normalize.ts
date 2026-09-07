import { createHash } from "node:crypto";
import type { EventBatch, ProjectRef, StoredEvent } from "@tracki/shared";
import { sanitizeVertexTrack } from "@tracki/shared";
import { scrubSerialized, scrubString, scrubValue } from "./scrub.js";

/**
 * For a `track` event, enforce a recognized named-event schema (currently the
 * Vertex tenant) at the edge: drop every prop not on the privacy-safe allowlist
 * BEFORE storage. Unrecognized track names fall back to the generic PII scrub.
 */
function normalizeProps(
  type: string,
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (type === "track") {
    const v = sanitizeVertexTrack(raw);
    if (v.ok) return v.props;
  }
  return raw ? (scrubValue(raw) as Record<string, unknown>) : undefined;
}

/**
 * Audit M1: store a coarse browser+OS family instead of the raw, high-entropy
 * User-Agent (fingerprinting / quasi-PII). Best-effort, no external dep.
 */
export function coarsenUA(ua: string): string {
  if (!ua) return "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Other";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iOS/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "Other";
  return `${browser}/${os}`;
}

/**
 * Turn a validated batch into PII-scrubbed StoredEvents ready for ClickHouse.
 * Every string field is masked here — raw PII must never reach storage. The
 * serialized props get a second `scrubSerialized` backstop (Audit N1).
 */
export function normalizeBatch(
  batch: EventBatch,
  ref: ProjectRef,
  ua: string,
  receivedAt: number,
): StoredEvent[] {
  const maxAge = 24 * 60 * 60 * 1000;
  const skew = 120_000;
  if (!Number.isSafeInteger(batch.sentAt) || batch.sentAt > receivedAt + skew) {
    throw new Error("invalid event time");
  }
  const correction = Math.max(0, batch.sentAt - receivedAt);
  for (const e of batch.events) {
    if (
      !Number.isSafeInteger(e.ts) ||
      e.ts <= 0 ||
      e.ts > receivedAt + skew ||
      e.ts - correction < receivedAt - maxAge
    )
      throw new Error("invalid event time");
  }
  const occurrences = new Map<string, number>();
  // implementation: mobile SDKs send a device block; absent ⇒ a browser batch. The
  // mobile "ua" is a coarse platform/os pair built server-side from the schema-
  // bounded device fields (never the raw UA header for app traffic).
  const device = batch.device;
  const coarseUa = device
    ? `App ${device.platform}${device.osVersion ? `/${device.osVersion}` : ""}`
    : coarsenUA(ua);
  const platform = device?.platform ?? "web";
  const appVersion = device?.appVersion ?? "";
  const deviceModel = device?.model ?? "";
  return batch.events.map((e) => {
    const props = normalizeProps(e.type, e.props);
    const fingerprint = canonical({ anon: batch.anonId, session: batch.sessionId, event: e });
    const ordinal = occurrences.get(fingerprint) ?? 0;
    occurrences.set(fingerprint, ordinal + 1);
    const identity = e.eventId ?? `${batch.sentAt}:${fingerprint}:${ordinal}`;
    const digest = createHash("sha256")
      .update(canonical([ref.orgId, ref.projectId, identity]))
      .digest("hex");
    return {
      org_id: ref.orgId,
      project_id: ref.projectId,
      anon_id: batch.anonId,
      user_id: scrubString(batch.userId),
      session_id: batch.sessionId,
      event_id: `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`,
      type: e.type,
      path: scrubString(e.path),
      url: scrubString(e.url),
      referrer: scrubString(e.referrer),
      props: props ? scrubSerialized(JSON.stringify(props)) : "{}",
      ua: coarseUa,
      platform,
      app_version: scrubString(appVersion),
      device_model: scrubString(deviceModel),
      ts: e.ts - correction,
      received_at: receivedAt,
    };
  });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
