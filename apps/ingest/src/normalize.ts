import { randomUUID } from "node:crypto";
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
  // Slice 14: mobile SDKs send a device block; absent ⇒ a browser batch. The
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
    return {
      org_id: ref.orgId,
      project_id: ref.projectId,
      anon_id: batch.anonId,
      user_id: batch.userId ?? "",
      session_id: batch.sessionId,
      event_id: randomUUID(),
      type: e.type,
      path: scrubString(e.path),
      url: scrubString(e.url),
      referrer: scrubString(e.referrer),
      props: props ? scrubSerialized(JSON.stringify(props)) : "{}",
      ua: coarseUa,
      platform,
      app_version: appVersion,
      device_model: deviceModel,
      ts: e.ts,
      received_at: receivedAt,
    };
  });
}
