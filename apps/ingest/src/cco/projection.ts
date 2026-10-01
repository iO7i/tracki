import type { StoredEvent, StruggleDetection } from "@tracki/shared";
import { nativeBuild } from "@tracki/shared/mobile-diagnostics";
import type { Project } from "./config";
import { type CcoEvent, event, nullableId, sessionRef, traceId } from "./contract";
export function projectBehavior(e: StoredEvent, scope: Project): CcoEvent {
  let props: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(e.props);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      props = parsed as Record<string, unknown>;
  } catch {
    /* Never retain raw properties. */
  }
  const c =
    props.ccoTrace && typeof props.ccoTrace === "object"
      ? (props.ccoTrace as Record<string, unknown>)
      : {};
  const build = nativeBuild(props.ccoBuild);
  const native = e.platform === "ios" || e.platform === "android";
  let trace: string | null = null;
  let cause: string | null = null;
  let span: string | null = null;
  let parent: string | null = null;
  try {
    trace = traceId(c.traceId);
    cause = nullableId(c.causedBy);
    span = traceId(c.spanId, 16);
    parent = traceId(c.parentSpanId, 16);
  } catch {
    /* Untrusted correlation omitted. */
  }
  return event({
    version: 1,
    eventId: `${native ? "native" : "browser"}:${e.event_id}`,
    orgId: e.org_id,
    projectId: e.project_id,
    accountId: null,
    appKey: scope.appKey,
    environment: scope.environment,
    installationId: null,
    generation: null,
    sessionRef: sessionRef(e.org_id, e.project_id, e.anon_id, e.session_id),
    traceId: trace,
    spanId: span,
    parentSpanId: parent,
    causedBy: cause,
    authority: "observed",
    source: native ? "tracki.native" : "tracki.browser",
    operation:
      e.type === "track" &&
      [
        "cco_request",
        "cco_response",
        "cco_network_failure",
        "landing_viewed",
        "signup_completed",
        "platform_selected",
        "oauth_started",
        "oauth_failed",
        "store_connected",
        "first_sync_completed",
        "first_profit_report_viewed",
        "subscription_started",
        "native_crash",
      ].includes(String(props.name))
        ? String(props.name)
        : e.type,
    outcome:
      e.type === "error" ||
      props.name === "native_crash" ||
      e.type === "payment_fail" ||
      e.type === "otp_fail" ||
      props.name === "cco_network_failure" ||
      (props.name === "cco_response" &&
        typeof props.statusCode === "number" &&
        props.statusCode >= 400)
        ? "failed"
        : "observed",
    errorCode:
      e.type === "error"
        ? native && ["JS_ERROR", "JS_FATAL", "NATIVE_CRASH"].includes(String(props.code))
          ? String(props.code)
          : "CLIENT_ERROR"
        : props.name === "native_crash"
          ? "NATIVE_CRASH"
          : null,
    route: e.path,
    release:
      (native && (build.updateId || build.buildId)) ||
      (/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(e.app_version) ? e.app_version : null),
    occurredAt: e.ts,
    receivedAt: e.received_at,
    durationMs: native && typeof props.durationMs === "number" ? props.durationMs : null,
    httpStatus: native && typeof props.statusCode === "number" ? props.statusCode : null,
    replay: null,
  });
}
export function projectDetection(
  d: StruggleDetection,
  trigger: StoredEvent,
  scope: Project,
): CcoEvent {
  return event({
    ...projectBehavior(trigger, scope),
    eventId: `detector:${d.struggle_id}`,
    authority: "derived",
    source: "tracki.detector",
    operation: d.type,
    outcome: "failed",
    errorCode: d.type,
    causedBy: `${trigger.platform === "ios" || trigger.platform === "android" ? "native" : "browser"}:${trigger.event_id}`,
  });
}
