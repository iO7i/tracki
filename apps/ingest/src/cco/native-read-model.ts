import type { CcoEvent } from "./contract";
import type { NativeHealth, NativeProtocol, OperationCorrelation } from "./native-meta";
export type EvidenceHealth = "healthy" | "delayed" | "incomplete" | "unavailable" | "misconfigured";
export type NativeHealthRow = {
  appKey: string;
  environment: string;
  projectId: string;
  accountId: string | null;
  status: EvidenceHealth;
  reason: string;
  basis: "client-reported-and-collector-observed" | "collector-only" | "no-evidence";
  lastReceivedAt: number | null;
  lastReportAt: number | null;
  lastSuccessfulDelivery: number | null;
  lastAttemptedDelivery: number | null;
  oldestQueuedAt: number | null;
  counters: {
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
  } | null;
  collectorReceivedEvents: number;
  reporterCount: number;
  staleReporterCount: number;
  compatibility: {
    fullySupported: number;
    olderCapabilitySet: number;
    deprecated: number;
    unsupported: number | null;
  };
  lastResponseCategory: string | null;
  completeness: "unknown" | "reported-loss" | "sampled" | "bounded-observation";
};
export type NativeIncident = {
  incidentId: string;
  status: "open" | "acknowledged" | "resolved" | "reopened";
  revision: number;
  appKey: string;
  environment: string;
  projectId: string;
  route: string | null;
  operation: string;
  errorCode: string;
  firstSeen: number;
  lastSeen: number;
  occurrenceCount: number;
  affectedContextCount: number;
  affectedAccountIds: string[];
  releases: string[];
  representativeEventId: string;
  evidenceHealth: EvidenceHealth;
  sdkVersion: string | null;
  schemaVersion: number | null;
};
export type NativeSession = {
  sessionRef: string;
  appKey: string;
  environment: string;
  accountId: string;
  installationId: string | null;
  firstSeen: number;
  lastSeen: number;
  build: { buildId?: string; runtimeVersion?: string; updateId?: string };
  release: string | null;
  protocol: NativeProtocol;
  evidenceHealth: EvidenceHealth;
  receivedEventCount: number;
  reportedHealth: NativeHealth | null;
};
export type NativeOperation = {
  correlationKey: string;
  appKey: string;
  environment: string;
  accountId: string | null;
  clientRequestIds: string[];
  requestIds: string[];
  operationIds: string[];
  jobIds: string[];
  traceIds: string[];
  firstSeen: number;
  lastSeen: number;
  observedOutcome: string;
  outcomeSource: string | null;
  authoritativeOutcome: boolean;
  incompleteChain: boolean;
  timeline: Array<{
    eventId: string;
    occurredAt: number;
    source: string;
    operation: string;
    outcome: string;
    stage: string | null;
    httpStatus: number | null;
    correlation: OperationCorrelation | null;
  }>;
};
export type NativeReleaseComparison = {
  appKey: string;
  environment: string;
  operation: string;
  route: string | null;
  baselineRelease: string;
  candidateRelease: string;
  baseline: {
    observedRequests: number;
    failures: number;
    estimatedFailureRate: number | null;
    p95DurationMs: number | null;
  };
  candidate: {
    observedRequests: number;
    failures: number;
    estimatedFailureRate: number | null;
    p95DurationMs: number | null;
  };
  result:
    | "possible regression"
    | "insufficient evidence"
    | "material increase observed"
    | "no material difference established";
  reason: string;
  sampled: boolean;
  minimumSampleSize: number;
  windowStart: number;
  windowEnd: number;
  causationEstablished: false;
};
export type NativeDiagnosticsSnapshot = {
  version: 1;
  generatedAt: number;
  windowStart: number;
  windowEnd: number;
  truncated: boolean;
  health: NativeHealthRow[];
  incidents: NativeIncident[];
  sessions: NativeSession[];
  operations: NativeOperation[];
  releases: NativeReleaseComparison[];
  deliveryFailures: Array<{
    appKey: string;
    environment: string;
    accountId: string;
    category: string;
    count: number;
    remediation: string;
    observedAt: number;
  }>;
};
export type NativeReadQuery = {
  appKey?: string;
  environment?: string;
  accountId?: string;
  incidentId?: string;
  baselineRelease?: string;
  candidateRelease?: string;
  since: number;
  now: number;
};
export type NativeSessionRecord = NativeSession & {
  orgId: string;
  projectId: string;
  scopeTag: string;
  reporterRevision: number;
};
export type NativeDiagnosticEvent = CcoEvent & {
  correlation?: OperationCorrelation | null;
  nativeProtocol?: NativeProtocol;
  sampleRate?: number | null;
  fingerprint?: string | null;
};
