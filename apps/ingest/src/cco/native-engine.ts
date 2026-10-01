import { digest } from "./contract";
import type { NativeProtocol } from "./native-meta";
import type {
  NativeDiagnosticEvent,
  NativeHealthRow,
  NativeOperation,
  NativeReleaseComparison,
  NativeSession,
} from "./native-read-model";

export function incidentIdentity(
  e: NativeDiagnosticEvent,
): { incidentId: string; errorCode: string } | null {
  if (e.outcome !== "failed" || (e.source !== "tracki.native" && !e.correlation)) return null;
  const errorCode =
    e.errorCode ??
    (e.httpStatus === 401 || e.httpStatus === 403
      ? "AUTH_REJECTED"
      : e.httpStatus && e.httpStatus >= 500
        ? "SERVER_FAILURE"
        : e.operation === "cco_network_failure"
          ? "NETWORK_FAILURE"
          : "OPERATION_FAILED");
  return {
    incidentId: digest([
      e.orgId,
      e.projectId,
      e.appKey,
      e.environment,
      e.route,
      e.operation,
      errorCode,
      e.release,
      e.nativeProtocol?.sdkVersion ?? null,
      e.nativeProtocol?.schemaVersion ?? null,
      e.fingerprint ?? null,
    ]),
    errorCode,
  };
}
export function classifyEvidence(
  sessions: NativeSession[],
  received: number,
  now: number,
): Pick<NativeHealthRow, "status" | "reason" | "basis" | "completeness"> {
  const reports = sessions.flatMap((s) => (s.reportedHealth ? [s.reportedHealth] : []));
  if (!reports.length)
    return {
      status: "unavailable",
      reason: received ? "capture_health_not_reported" : "no_evidence_received",
      basis: received ? "collector-only" : "no-evidence",
      completeness: "unknown",
    };
  if (
    reports.some(
      (h) =>
        h.unsupportedSchema > 0 ||
        [
          "context_unverified",
          "authentication_rejected",
          "revoked_context",
          "environment_mismatch",
          "unsupported_schema",
        ].includes(h.lastResponseCategory),
    )
  )
    return {
      status: "misconfigured",
      reason: "context_or_compatibility_failure_reported",
      basis: "client-reported-and-collector-observed",
      completeness: "reported-loss",
    };
  if (
    reports.some((h) => h.droppedCapacity + h.droppedExpired + h.rejected + h.storageFailures > 0)
  )
    return {
      status: "incomplete",
      reason: "evidence_loss_reported",
      basis: "client-reported-and-collector-observed",
      completeness: "reported-loss",
    };
  if (
    reports.some(
      (h) =>
        h.observedAt < now - 20 * 60000 ||
        h.retryingCount > 0 ||
        h.queueDepth > 0 ||
        [
          "network_unavailable",
          "rate_limited",
          "retryable_server_failure",
          "invalid_acknowledgment",
        ].includes(h.lastResponseCategory),
    )
  )
    return {
      status: "delayed",
      reason: "queued_retrying_or_stale_report",
      basis: "client-reported-and-collector-observed",
      completeness: "unknown",
    };
  return {
    status: "healthy",
    reason: "recent_health_report_with_no_known_loss",
    basis: "client-reported-and-collector-observed",
    completeness: reports.some((h) => h.sampledOut > 0) ? "sampled" : "bounded-observation",
  };
}

/** Connected components are scoped by verified tenant and app/environment, never opaque IDs alone. */
export function operationTimelines(events: NativeDiagnosticEvent[]): NativeOperation[] {
  const groups = new Map<string, NativeDiagnosticEvent[]>();
  const parent = new Map<string, string>();
  const root = (k: string): string => {
    const p = parent.get(k);
    if (!p || p === k) {
      parent.set(k, k);
      return k;
    }
    const r = root(p);
    parent.set(k, r);
    return r;
  };
  const key = (e: NativeDiagnosticEvent, kind: string, id: string) =>
    JSON.stringify([
      e.orgId,
      e.projectId,
      e.accountId,
      e.installationId,
      e.generation,
      e.appKey,
      e.environment,
      kind,
      id,
    ]);
  const tokens = (e: NativeDiagnosticEvent) => [
    ...Object.entries(e.correlation ?? {})
      .filter(([k]) => ["clientRequestId", "requestId", "operationId", "jobId"].includes(k))
      .map(([kind, id]) => key(e, kind, String(id))),
    ...(e.traceId ? [key(e, "traceId", e.traceId)] : []),
  ];
  for (const e of events) {
    const t = tokens(e);
    const firstToken = t[0];
    if (!firstToken) continue;
    for (const next of t.slice(1)) {
      const a = root(firstToken);
      const b = root(next);
      if (a !== b) {
        parent.set(b, a < b ? a : b);
        parent.set(a, a < b ? a : b);
      }
    }
  }
  for (const e of events) {
    const t = tokens(e);
    const firstToken = t[0];
    if (!firstToken) continue;
    const k = root(firstToken);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups]
    .map(([k, input]) => {
      const sorted = input.sort(
        (a, b) => a.occurredAt - b.occurredAt || a.eventId.localeCompare(b.eventId),
      );
      const ids = (field: "clientRequestId" | "requestId" | "operationId" | "jobId") => [
        ...new Set(
          sorted.flatMap((e) => {
            const value = e.correlation?.[field];
            return value ? [value] : [];
          }),
        ),
      ];
      const readback = [...sorted]
        .reverse()
        .find(
          (e) =>
            e.authority === "server-reported" &&
            e.correlation?.stage === "outcome" &&
            e.correlation.outcomeSource === "readback" &&
            ["succeeded", "failed", "cancelled"].includes(e.correlation.outcomeState ?? ""),
        );
      const outcome = readback ?? [...sorted].reverse().find((e) => e.correlation?.outcomeState);
      const first = sorted[0];
      const last = sorted.at(-1);
      if (!first || !last) throw new Error("NATIVE_OPERATION_GROUP_EMPTY");
      return {
        correlationKey: digest(k),
        appKey: first.appKey,
        environment: first.environment,
        accountId: first.accountId,
        clientRequestIds: ids("clientRequestId"),
        requestIds: ids("requestId"),
        operationIds: ids("operationId"),
        jobIds: ids("jobId"),
        traceIds: [...new Set(sorted.flatMap((e) => (e.traceId ? [e.traceId] : [])))],
        firstSeen: first.occurredAt,
        lastSeen: last.occurredAt,
        observedOutcome: outcome?.correlation?.outcomeState ?? "unknown",
        outcomeSource: outcome?.correlation?.outcomeSource ?? null,
        authoritativeOutcome: !!readback,
        incompleteChain:
          !readback ||
          !sorted.some((e) => e.source === "tracki.native") ||
          !sorted.some((e) => e.authority === "server-reported"),
        timeline: sorted.slice(-100).map((e) => ({
          eventId: e.eventId,
          occurredAt: e.occurredAt,
          source: e.source,
          operation: e.operation,
          outcome: e.outcome,
          stage: e.correlation?.stage ?? null,
          httpStatus: e.httpStatus ?? null,
          correlation: e.correlation ?? null,
        })),
      };
    })
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 100);
}

export function releaseComparisons(
  events: NativeDiagnosticEvent[],
  baselineRelease: string | undefined,
  candidateRelease: string | undefined,
  since: number,
  now: number,
  truncated: boolean,
): NativeReleaseComparison[] {
  if (!baselineRelease || !candidateRelease || baselineRelease === candidateRelease) return [];
  const relevant = events.filter(
    (e) =>
      e.source === "tracki.native" &&
      ["cco_response", "cco_network_failure"].includes(e.operation) &&
      [baselineRelease, candidateRelease].includes(e.release ?? ""),
  );
  const groups = new Map<string, NativeDiagnosticEvent[]>();
  for (const e of relevant) {
    const k = JSON.stringify([e.appKey, e.environment, e.route]);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups].slice(0, 100).map(([key, rows]) => {
    const [appKey, environment, route] = JSON.parse(key) as [string, string, string | null];
    const stats = (release: string) => {
      // One terminal client observation per request; response retries never duplicate accepted IDs.
      const unique = new Map<string, NativeDiagnosticEvent>();
      for (const e of rows.filter((e) => e.release === release))
        unique.set(e.correlation?.clientRequestId ?? e.spanId ?? e.eventId, e);
      const values = [...unique.values()];
      const failures = values.filter((e) => e.outcome === "failed").length;
      const completeSampling = values.every(
        (e) => typeof e.sampleRate === "number" && e.sampleRate > 0 && e.sampleRate <= 1,
      );
      const weighted = values.reduce((sum, e) => sum + 1 / (e.sampleRate ?? 1), 0);
      const weightedFailure = values
        .filter((e) => e.outcome === "failed")
        .reduce((sum, e) => sum + 1 / (e.sampleRate ?? 1), 0);
      const durations = values
        .flatMap((e) => (e.durationMs == null ? [] : [e.durationMs]))
        .sort((a, b) => a - b);
      return {
        observedRequests: values.length,
        failures,
        estimatedFailureRate: completeSampling && weighted ? weightedFailure / weighted : null,
        p95DurationMs: durations.length
          ? (durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] ?? null)
          : null,
      };
    };
    const baseline = stats(baselineRelease);
    const candidate = stats(candidateRelease);
    const sampled = rows.some((e) => (e.sampleRate ?? 1) < 1);
    let result: NativeReleaseComparison["result"] = "insufficient evidence";
    let reason = "minimum_30_comparable_terminal_requests_required";
    if (
      !truncated &&
      baseline.observedRequests >= 30 &&
      candidate.observedRequests >= 30 &&
      baseline.estimatedFailureRate != null &&
      candidate.estimatedFailureRate != null
    ) {
      const difference = candidate.estimatedFailureRate - baseline.estimatedFailureRate;
      const latency =
        baseline.p95DurationMs != null &&
        candidate.p95DurationMs != null &&
        candidate.p95DurationMs >= baseline.p95DurationMs * 1.5 &&
        candidate.p95DurationMs - baseline.p95DurationMs >= 250;
      if (
        difference >= 0.05 &&
        candidate.estimatedFailureRate >= baseline.estimatedFailureRate * 1.5
      ) {
        result = sampled ? "possible regression" : "material increase observed";
        reason = "failure_rate_increase_observed";
      } else if (latency) {
        result = "possible regression";
        reason = "observed_latency_increase_not_sample_adjusted";
      } else {
        result = "no material difference established";
        reason = "configured_material_threshold_not_exceeded";
      }
    } else if (truncated) reason = "bounded_read_truncated";
    else if (baseline.estimatedFailureRate == null || candidate.estimatedFailureRate == null)
      reason = "sampling_probability_missing";
    return {
      appKey,
      environment,
      operation: "client_request",
      route,
      baselineRelease,
      candidateRelease,
      baseline,
      candidate,
      result,
      reason,
      sampled,
      minimumSampleSize: 30,
      windowStart: since,
      windowEnd: now,
      causationEstablished: false as const,
    };
  });
}
export const compatibilityCounts = (protocols: NativeProtocol[]) => ({
  fullySupported: protocols.filter((p) => p.compatibility === "fully-supported").length,
  olderCapabilitySet: protocols.filter((p) => p.compatibility === "older-capability-set").length,
  deprecated: protocols.filter((p) => p.compatibility === "deprecated").length,
  unsupported: null,
});
