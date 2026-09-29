/** CCO v1 wire contract. Mirrored into both repositories; parity is tested. */
import { createHash } from "node:crypto";

export type Authority = "observed" | "derived" | "server-reported";
export type Outcome = "observed" | "succeeded" | "failed" | "pending" | "unknown";
export type ReplayInput = {
  adapter: "workflow-routing.v1" | "installation-generation.v1";
  expectedNamespace?: string;
  requestedNamespace?: string;
  expectedTaskQueue?: string;
  requestedTaskQueue?: string;
  expectedGeneration?: number;
  providedGeneration?: number;
};
export type CcoEvent = {
  version: 1;
  eventId: string;
  orgId: string;
  projectId: string;
  accountId: string | null;
  appKey: string;
  environment: string;
  installationId: string | null;
  generation: number | null;
  sessionRef: string | null;
  traceId: string | null;
  spanId: string | null;
  parentSpanId: string | null;
  causedBy: string | null;
  authority: Authority;
  source: string;
  operation: string;
  outcome: Outcome;
  errorCode: string | null;
  route: string | null;
  release: string | null;
  occurredAt: number;
  receivedAt: number;
  replay: ReplayInput | null;
  actorKind?: "human" | "worker" | "support" | "system";
  targetAppKey?: string | null;
  durationMs?: number | null;
  httpStatus?: number | null;
};
export type CcoSnapshot = {
  version: 1;
  generatedAt: number;
  windowStart: number;
  events: CcoEvent[];
  truncated: boolean;
  coverage: {
    status: "available" | "not-configured" | "unavailable";
    reason: string;
    lastReceivedAt: number | null;
    pending: number | null;
    deadLetters: number | null;
    oldestPendingAt: number | null;
  };
};
export class CcoError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
    this.name = "CcoError";
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CcoError("invalid_object");
  return value as Record<string, unknown>;
}
export function id(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value))
    throw new CcoError("invalid_identifier");
  return value;
}
export function nullableId(value: unknown): string | null {
  return value == null ? null : id(value);
}
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new CcoError("invalid_integer");
  return value;
}
export function optionalInteger(value: unknown): number | null {
  return value == null ? null : integer(value);
}
export function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T))
    throw new CcoError("invalid_enum");
  return value as T;
}
export function traceId(value: unknown, length = 32): string | null {
  if (value == null) return null;
  if (
    typeof value !== "string" ||
    !new RegExp(`^[a-f0-9]{${length}}$`).test(value) ||
    /^0+$/.test(value)
  )
    throw new CcoError("invalid_trace_context");
  return value;
}
export function parseTraceparent(value: unknown): { traceId: string; parentSpanId: string } | null {
  if (typeof value !== "string") return null;
  const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-[a-f0-9]{2}$/.exec(value);
  if (!match || !match[1] || !match[2] || /^0+$/.test(match[1]) || /^0+$/.test(match[2]))
    return null;
  return { traceId: match[1], parentSpanId: match[2] };
}
/** Deliberately drops all queries/fragments, free text, and identifier-like route segments. */
const ROUTE_SEGMENTS=new Set(["api", "v1", "v2", "app", "auth", "identity", "login", "logout", "callback", "bootstrap", "events", "cco", "health", "ready", "metrics", "dashboard", "settings", "products", "product", "images", "links", "technical", "seo", "reviews", "loyalty", "matrix", "refer", "recur", "social", "signals", "cross_sell", "digital_downloads", "store-audit", "profit", "reports", "report", "orders", "customers", "connections", "session", "gateway-entry", "entry", "action", "onboarding", "sync", "jobs", "import", "export", "bulk-edit", "billing", "checkout", "plans", "subscriptions", "support", "notifications", "widgets", "store", "stores", "me", "account", "accounts", "organizations", "members", "usage", "invoices", "payments", "webhooks", "internal", "public", "context", "installations", "execute", "invoke", "completion"]);
export function safeRoute(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 2048) throw new CcoError("invalid_route");
  let pathname: string;
  try {
    pathname = new URL(value, "https://redacted.invalid").pathname;
  } catch {
    return null;
  }
  return pathname
    .split("/")
    .slice(0, 12)
    .map((encodedSegment) => {
      let segment = encodedSegment;
      try {
        segment = decodeURIComponent(segment);
      } catch {
        return ":redacted";
      }
      return ROUTE_SEGMENTS.has(segment) ? segment : segment ? ":id" : "";
    })
    .join("/")
    .slice(0, 240);
}
export function replayInput(value: unknown): ReplayInput | null {
  if (value == null) return null;
  const r = object(value);
  const adapter = choice(r.adapter, ["workflow-routing.v1", "installation-generation.v1"] as const);
  if (adapter === "workflow-routing.v1")
    return {
      adapter,
      expectedNamespace: id(r.expectedNamespace),
      requestedNamespace: id(r.requestedNamespace),
      expectedTaskQueue: id(r.expectedTaskQueue),
      requestedTaskQueue: id(r.requestedTaskQueue),
    };
  return {
    adapter,
    expectedGeneration: integer(r.expectedGeneration),
    providedGeneration: integer(r.providedGeneration),
  };
}
export function event(value: unknown): CcoEvent {
  const r = object(value);
  if (r.version !== 1) throw new CcoError("unsupported_protocol");
  const authority = choice(r.authority, ["observed", "derived", "server-reported"] as const);
  const replay = replayInput(r.replay);
  if (authority !== "server-reported" && replay) throw new CcoError("untrusted_replay_input");
  return {
    version: 1,
    eventId: id(r.eventId),
    orgId: id(r.orgId),
    projectId: id(r.projectId),
    accountId: nullableId(r.accountId),
    appKey: id(r.appKey),
    environment: id(r.environment),
    installationId: nullableId(r.installationId),
    generation: optionalInteger(r.generation),
    sessionRef: nullableId(r.sessionRef),
    traceId: traceId(r.traceId),
    spanId: traceId(r.spanId, 16),
    parentSpanId: traceId(r.parentSpanId, 16),
    causedBy: nullableId(r.causedBy),
    authority,
    source: id(r.source),
    operation: id(r.operation),
    outcome: choice(r.outcome, ["observed", "succeeded", "failed", "pending", "unknown"] as const),
    errorCode: nullableId(r.errorCode),
    route: safeRoute(r.route),
    release: nullableId(r.release),
    occurredAt: integer(r.occurredAt, 1),
    receivedAt: integer(r.receivedAt, 1),
    replay,
    actorKind:
      r.actorKind == null
        ? r.authority === "observed"
          ? "human"
          : "system"
        : choice(r.actorKind, ["human", "worker", "support", "system"] as const),
    targetAppKey: nullableId(r.targetAppKey),
    durationMs: r.durationMs == null ? null : integer(r.durationMs, 0, 86400000),
    httpStatus: r.httpStatus == null ? null : integer(r.httpStatus, 100, 599),
  };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function correlationId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value))
    throw new CcoError("invalid_correlation_id");
  return value;
}
export function sessionRef(
  orgId: string,
  projectId: string,
  anonId: string,
  sessionId: string,
): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(anonId) || !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId))
    throw new CcoError("invalid_correlation_id");
  return digest([orgId, projectId, correlationId(anonId), correlationId(sessionId)]);
}
export function parseSnapshot(value: unknown): CcoSnapshot {
  const r = object(value);
  const c = object(r.coverage);
  if (
    r.version !== 1 ||
    !Array.isArray(r.events) ||
    r.events.length > 1000 ||
    typeof r.truncated !== "boolean"
  )
    throw new CcoError("invalid_snapshot");
  const events = r.events.map(event);
  const seen = new Set<string>();
  for (const e of events) {
    const key = canonical([e.orgId, e.projectId, e.eventId]);
    if (seen.has(key)) throw new CcoError("duplicate_snapshot_identity");
    seen.add(key);
  }
  return {
    version: 1,
    generatedAt: integer(r.generatedAt, 1),
    windowStart: integer(r.windowStart, 1),
    events,
    truncated: r.truncated,
    coverage: {
      status: choice(c.status, ["available", "not-configured", "unavailable"] as const),
      reason: typeof c.reason === "string" ? c.reason.slice(0, 240) : "Source coverage unknown.",
      lastReceivedAt: optionalInteger(c.lastReceivedAt),
      pending: optionalInteger(c.pending),
      deadLetters: optionalInteger(c.deadLetters),
      oldestPendingAt: optionalInteger(c.oldestPendingAt),
    },
  };
}
