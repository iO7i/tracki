export interface CollectionBudget {
  maxQueuedEvents: number; maxQueuedBytes: number; eventTtlMs: number;
  batchSize: number; batchByteLimit: number; routineSuccessSampleRate: number;
  unusualLatencyMs: number;
}
export const nativeProtocol = Object.freeze({ sdkVersion: "0.2.1", schemaVersion: 2,
  capabilities: ["capture-health-v1", "operation-correlation-v1", "sampling-v1", "build-identity-v1", "diagnostics-v2"] });
export const defaultCollectionBudget: CollectionBudget = {
  maxQueuedEvents: 500, maxQueuedBytes: 512 * 1024, eventTtlMs: 23 * 3600000,
  batchSize: 50, batchByteLimit: 96 * 1024, routineSuccessSampleRate: 1, unusualLatencyMs: 3000,
};
export function collectionBudget(value: Partial<CollectionBudget> = {}): CollectionBudget {
  const result = { ...defaultCollectionBudget };
  for (const [key, min, max] of [
    ["maxQueuedEvents", 1, 500], ["maxQueuedBytes", 1024, 512 * 1024],
    ["eventTtlMs", 1000, 23 * 3600000], ["batchSize", 1, 50],
    ["batchByteLimit", 1024, 96 * 1024], ["unusualLatencyMs", 1, 86400000],
  ] as const) {
    const v = value[key]; if (v !== undefined) {
      if (!Number.isSafeInteger(v) || v < min || v > max) throw new Error(`Invalid diagnostic budget: ${key}`);
      result[key] = v;
    }
  }
  const rate = value.routineSuccessSampleRate;
  if (rate !== undefined) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error("Invalid diagnostic sample rate");
    result.routineSuccessSampleRate = rate;
  }
  result.batchByteLimit = Math.min(result.batchByteLimit, result.maxQueuedBytes);
  return result;
}
/** UTF-8 accounting without Node APIs or a TextEncoder requirement on Hermes. */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 128) bytes++; else if (c < 2048) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}
export function deliveryCategory(error: unknown): string {
  const e = error && typeof error === "object" ? error as { status?: number; code?: string } : {};
  if (["authentication_rejected", "context_unverified", "revoked_context", "environment_mismatch", "unsupported_schema", "rate_limited", "payload_too_large", "retryable_server_failure", "permanent_rejection", "network_unavailable", "expired", "local_storage_failure", "invalid_acknowledgment"].includes(e.code ?? "")) return e.code!;
  if (e.code === "invalid-acknowledgment" || e.code === "invalid-ack") return "invalid_acknowledgment";
  if (e.code === "batch-too-large") return "payload_too_large";
  if (e.code === "unbound-batch" || e.code === "unbound-historical-batch" || e.code === "authentication-required") return "context_unverified";
  if (e.code === "secure-storage-unavailable") return "local_storage_failure";
  if (e.status === 401 || e.status === 403) return "authentication_rejected";
  if (e.status === 409) return "revoked_context";
  if (e.status === 410) return "expired";
  if (e.status === 422 || e.status === 426) return "unsupported_schema";
  if (e.status === 429) return "rate_limited";
  if (e.status === 413) return "payload_too_large";
  if (e.status && e.status >= 500) return "retryable_server_failure";
  if (e.status && e.status >= 400) return "permanent_rejection";
  return "network_unavailable";
}
export function isPermanentCategory(category: string): boolean {
  return ["authentication_rejected", "context_unverified", "revoked_context", "environment_mismatch", "unsupported_schema", "payload_too_large", "permanent_rejection", "expired"].includes(category);
}
