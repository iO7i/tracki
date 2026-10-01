import { nativeResponseCategories, sanitizeNativeHealth } from "@tracki/shared/mobile-diagnostics";
import { CcoError, integer, object as record } from "./contract";
export const NATIVE_CAPABILITIES = [
  "capture-health-v1",
  "operation-correlation-v1",
  "sampling-v1",
  "build-identity-v1",
  "native-crash-v1",
  "diagnostics-v2",
] as const;
export type NativeProtocol = {
  sdkVersion: string;
  schemaVersion: 1 | 2;
  capabilities: string[];
  requiredCapabilities: string[];
  compatibility: "fully-supported" | "older-capability-set" | "deprecated";
};
export function nativeProtocol(value: unknown): NativeProtocol {
  if (value == null)
    return {
      sdkVersion: "legacy",
      schemaVersion: 1,
      capabilities: [],
      requiredCapabilities: [],
      compatibility: "older-capability-set",
    };
  const raw = record(value);
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2)
    throw new CcoError("unsupported_native_schema", 422);
  if (
    typeof raw.sdkVersion !== "string" ||
    !/^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[a-z0-9.-]{1,32})?$/.test(raw.sdkVersion)
  )
    throw new CcoError("unsupported_native_sdk", 422);
  if (!/^0\.[12]\./.test(raw.sdkVersion)) throw new CcoError("unsupported_native_sdk", 422);
  const list = (v: unknown): string[] => {
    if (v == null) return [];
    if (
      !Array.isArray(v) ||
      v.length > 16 ||
      v.some((x) => typeof x !== "string" || !/^[a-z][a-z0-9.-]{0,63}$/.test(x))
    )
      throw new CcoError("invalid_native_capabilities", 422);
    return [...new Set(v as string[])].sort();
  };
  const capabilities = list(raw.capabilities);
  const requiredCapabilities = list(raw.requiredCapabilities);
  if (
    requiredCapabilities.some(
      (c) => !(NATIVE_CAPABILITIES as readonly string[]).includes(c) || !capabilities.includes(c),
    )
  )
    throw new CcoError("unsupported_native_capability", 422);
  return {
    sdkVersion: raw.sdkVersion,
    schemaVersion: raw.schemaVersion,
    capabilities,
    requiredCapabilities,
    compatibility:
      raw.schemaVersion === 1
        ? "deprecated"
        : capabilities.some((c) => !(NATIVE_CAPABILITIES as readonly string[]).includes(c))
          ? "older-capability-set"
          : "fully-supported",
  };
}
export type NativeHealth = {
  reporterId: string;
  revision: number;
  observedAt: number;
  observed: number;
  sampledOut: number;
  droppedCapacity: number;
  droppedExpired: number;
  rejected: number;
  storageFailures: number;
  unsupportedSchema: number;
  accepted: number;
  queueDepth: number;
  queueBytes: number;
  retryingCount: number;
  routineSuccessSampleRate: number;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  oldestQueuedAt?: number;
  lastResponseCategory: string;
};
export const DELIVERY_CATEGORIES = nativeResponseCategories;
export function nativeHealth(value: unknown, now: number): NativeHealth {
  const sanitized = sanitizeNativeHealth(value);
  if (!sanitized) throw new CcoError("invalid_native_health");
  const raw = record(sanitized);
  const result: Record<string, unknown> = {};
  result.reporterId = raw.reporterId;
  result.revision = integer(raw.revision, 0, Number.MAX_SAFE_INTEGER);
  result.observedAt = integer(raw.observedAt, now - 23 * 3600000, now + 120000);
  for (const key of [
    "observed",
    "sampledOut",
    "droppedCapacity",
    "droppedExpired",
    "rejected",
    "storageFailures",
    "unsupportedSchema",
    "accepted",
    "queueDepth",
    "queueBytes",
    "retryingCount",
  ])
    result[key] = integer(raw[key], 0, 1e9);
  for (const key of ["lastAttemptAt", "lastSuccessAt", "oldestQueuedAt"])
    if (raw[key] != null) result[key] = integer(raw[key], 1, Number(result.observedAt) + 120000);
  if (
    typeof raw.routineSuccessSampleRate !== "number" ||
    !Number.isFinite(raw.routineSuccessSampleRate) ||
    raw.routineSuccessSampleRate < 0 ||
    raw.routineSuccessSampleRate > 1
  )
    throw new CcoError("invalid_native_sampling");
  result.routineSuccessSampleRate = raw.routineSuccessSampleRate;
  if (!(DELIVERY_CATEGORIES as readonly unknown[]).includes(raw.lastResponseCategory))
    throw new CcoError("invalid_native_delivery_category");
  result.lastResponseCategory = raw.lastResponseCategory;
  return result as NativeHealth;
}
export function nativeRejectionCategory(status: number, code?: string): string {
  if (code === "native_environment_mismatch") return "environment_mismatch";
  if (
    [
      "native_identity_changed",
      "native_capture_disabled",
      "native_binding_mismatch",
      "native_session_identity_conflict",
      "native_health_identity_conflict",
      "native_health_counter_regression",
    ].includes(code ?? "")
  )
    return "revoked_context";
  if (
    [
      "native_human_binding_required",
      "native_scope_required",
      "native_capture_decision_unavailable",
      "native_authority_required",
    ].includes(code ?? "")
  )
    return "context_unverified";
  return deliveryFailure(status).category;
}
export type OperationCorrelation = {
  clientRequestId?: string;
  requestId?: string;
  operationId?: string;
  jobId?: string;
  stage?: "request" | "operation" | "job" | "outcome";
  outcomeState?:
    | "accepted"
    | "pending"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "unknown";
  outcomeSource?: "client" | "backend" | "job" | "readback";
};
export function operationCorrelation(value: unknown, client = false): OperationCorrelation | null {
  if (value == null) return null;
  const raw = record(value);
  const out: Record<string, string> = {};
  const opaque =
    /^(?:(?:op_|job_|req_)?(?:[a-f0-9]{16,64}|[0-9A-HJKMNP-TV-Z]{26}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}))$/i;
  for (const key of ["clientRequestId", "requestId", "operationId", "jobId"])
    if (raw[key] != null) {
      if (typeof raw[key] !== "string" || !opaque.test(raw[key] as string))
        throw new CcoError("invalid_operation_reference");
      out[key] = raw[key] as string;
    }
  const choices = {
    stage: ["request", "operation", "job", "outcome"],
    outcomeState: ["accepted", "pending", "running", "succeeded", "failed", "cancelled", "unknown"],
    outcomeSource: ["client", "backend", "job", "readback"],
  };
  for (const [key, values] of Object.entries(choices))
    if (raw[key] != null) {
      if (typeof raw[key] !== "string" || !values.includes(raw[key] as string))
        throw new CcoError("invalid_operation_outcome");
      out[key] = raw[key] as string;
    }
  if (client && out.outcomeSource) out.outcomeSource = "client";
  return out;
}
export function deliveryFailure(status?: number): {
  category: string;
  retryable: boolean;
  remediation: string;
} {
  if (status == null)
    return {
      category: "network_unavailable",
      retryable: true,
      remediation: "restore_connectivity",
    };
  if (status === 401 || status === 403)
    return {
      category: "authentication_rejected",
      retryable: false,
      remediation: "verify_server_credentials",
    };
  if (status === 409)
    return {
      category: "revoked_context",
      retryable: false,
      remediation: "reconnect_verified_context",
    };
  if (status === 410)
    return { category: "expired", retryable: false, remediation: "discard_expired_evidence" };
  if (status === 413)
    return { category: "payload_too_large", retryable: false, remediation: "reduce_batch_budget" };
  if (status === 422)
    return {
      category: "unsupported_schema",
      retryable: false,
      remediation: "upgrade_supported_sdk",
    };
  if (status === 429)
    return {
      category: "rate_limited",
      retryable: true,
      remediation: "backoff_and_reduce_success_sampling",
    };
  if (status >= 500 || status === 408)
    return {
      category: "retryable_server_failure",
      retryable: true,
      remediation: "restore_collector_or_outbox",
    };
  return { category: "permanent_rejection", retryable: false, remediation: "repair_envelope" };
}
