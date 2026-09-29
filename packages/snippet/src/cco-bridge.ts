import { installCapture } from "./capture";
import { EventQueue } from "./queue";
import { getAnonId, getSessionId, resetIdentity } from "./storage";
import type { Batch, EventInput } from "./types";
// The host's authenticated API authorizes every batch; these grants are never login credentials.
type Grant = { token: string; scopeTag: string; expiresAt: number };
const script = document.currentScript as HTMLScriptElement | null;
const win = window as Window & { vertexCco?: unknown; __VERTEX_CCO_CONSENT__?: boolean };
const app = script?.dataset.app ?? "";
const bootstrap = script?.dataset.bootstrap ?? "";
const endpoint = script?.dataset.events ?? "";
const key = `vertex-cco-grant:${app}:${endpoint}`;
const originalFetch = window.fetch.bind(window);
let active = false;
let epoch = 0;
let busy = false;
let queue: EventQueue | undefined;
let teardown: (() => void) | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let authorityTag: string | null = null;
let grant: Grant | null = null;
const pending = new Map<string, { traceId: string; spanId: string; path: string }>();
const id = () => crypto.randomUUID().replace(/-/g, "");
const path = (url: string) => {
  try {
    return new URL(url, location.origin).pathname
      .split("/")
      .slice(0, 12)
      .map((p) => (STATIC.has(p) ? p : p ? ":id" : ""))
      .join("/");
  } catch {
    return "/";
  }
};
// Literal route vocabulary only. IDs, arbitrary slugs, queries and fragments are never serialized.
const STATIC = new Set(
  "api v1 v2 app auth identity login logout callback bootstrap events cco health ready metrics dashboard settings products images links technical seo reviews loyalty matrix refer recur social signals profit reports orders customers connections session entry onboarding sync jobs import export billing checkout plans subscriptions support notifications widgets stores account organizations members usage invoices payments internal public".split(
    " ",
  ),
);
function privacySignal(): boolean {
  return (
    navigator.doNotTrack === "1" ||
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  );
}
function safeConfig(): boolean {
  try {
    const a = new URL(bootstrap);
    const b = new URL(endpoint);
    return (
      /^[a-z][a-z0-9_]{0,63}$/.test(app) &&
      a.origin === b.origin &&
      (a.protocol === "https:" ||
        (a.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(a.hostname))) &&
      !a.username &&
      !a.password &&
      !b.username &&
      !b.password
    );
  } catch {
    return false;
  }
}
function save(): void {
  try {
    if (grant) localStorage.setItem(key, JSON.stringify(grant));
    else localStorage.removeItem(key);
  } catch {}
}
function load(): Grant | null {
  try {
    const g = JSON.parse(localStorage.getItem(key) ?? "null");
    return g &&
      typeof g.token === "string" &&
      g.token.length <= 4096 &&
      /^[a-f0-9]{64}$/.test(g.scopeTag) &&
      typeof g.expiresAt === "number"
      ? g
      : null;
  } catch {
    return null;
  }
}
function scrub(e: EventInput): EventInput {
  const p = e.props ?? {};
  return {
    type: e.type,
    ts: e.ts,
    eventId: e.eventId,
    path: path(e.path ?? location.pathname),
    traceContext: e.traceContext,
    props: {
      ...(typeof p.tag === "string" ? { tag: p.tag } : {}),
      ...(e.type === "error" ? { code: "CLIENT_ERROR" } : {}),
      ...(e.type === "track"
        ? {
            name: p.name,
            ...(typeof p.statusCode === "number" ? { statusCode: p.statusCode } : {}),
          }
        : {}),
    },
  };
}
function emit(e: EventInput): void {
  if (active && !privacySignal()) queue?.enqueue(scrub(e));
}
async function authorize(
  anonId: string,
  sessionId: string,
  runEpoch: number,
): Promise<Grant | null> {
  const response = await originalFetch(bootstrap, {
    method: "POST",
    credentials: "include",
    redirect: "error",
    headers: { "content-type": "application/json", "x-vertex-csrf": "1" },
    body: JSON.stringify({ anonId, sessionId, previousToken: grant?.token }),
    signal: AbortSignal.timeout(5000),
  });
  if (!active || runEpoch !== epoch) return null;
  if ([401, 403, 409, 410].includes(response.status)) {
    reset();
    return null;
  }
  if (!response.ok) return null;
  const next = (await response.json()) as Grant;
  if (
    typeof next.token !== "string" ||
    next.token.length > 4096 ||
    !/^[a-f0-9]{64}$/.test(next.scopeTag) ||
    !Number.isFinite(next.expiresAt)
  )
    return null;
  if (authorityTag && next.scopeTag !== authorityTag) {
    reset();
    return null;
  }
  grant = next;
  authorityTag = next.scopeTag;
  save();
  return next;
}
async function send(_endpoint: string, batch: Batch, beacon: boolean): Promise<boolean> {
  if (!active || privacySignal()) return false;
  const runEpoch = epoch;
  try {
    // Recheck authenticated account before forwarding queued events, never rebind old evidence.
    const current = await authorize(batch.anonId, batch.sessionId, runEpoch);
    if (!current || !active || epoch !== runEpoch) return false;
    const response = await originalFetch(endpoint, {
      method: "POST",
      credentials: "include",
      redirect: "error",
      keepalive: beacon,
      headers: { "content-type": "application/json", "x-vertex-csrf": "1" },
      body: JSON.stringify({ token: current.token, batch }),
      signal: AbortSignal.timeout(5000),
    });
    if (epoch !== runEpoch || !active) return false;
    if ([401, 403, 409, 410].includes(response.status)) {
      reset();
      return false;
    }
    if (response.status !== 202) return false;
    const ack = await response.json();
    const ids = batch.events.map((e) => e.eventId);
    return (
      Array.isArray(ack.acceptedClientIds) &&
      ack.acceptedClientIds.length === ids.length &&
      ids.every((value) => ack.acceptedClientIds.includes(value))
    );
  } catch {
    return false;
  }
}
function clearRuntime(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  teardown?.();
  teardown = undefined;
  queue?.setConsent(false);
  queue = undefined;
  pending.clear();
}
function stop(): void {
  try {
    for (const k of Object.keys(localStorage))
      if (k.startsWith(`tracki_delivery:cco_${app}:`)) localStorage.removeItem(k);
  } catch {}
  active = false;
  epoch++;
  clearRuntime();
  grant = null;
  authorityTag = null;
  save();
}
function reset(): void {
  const resume = active;
  stop();
  resetIdentity();
  if (resume) timer = setTimeout(() => consent(true), 60000);
}
function consent(value: boolean): void {
  if (!value || privacySignal()) {
    stop();
    return;
  }
  if (active) return;
  active = true;
  grant = load();
  authorityTag = grant?.scopeTag ?? null;
  void refresh();
}
async function refresh(): Promise<void> {
  if (!active || busy || privacySignal()) return;
  busy = true;
  const runEpoch = epoch;
  try {
    const current = await authorize(getAnonId(), getSessionId(), runEpoch);
    if (!current || !active || runEpoch !== epoch) return;
    if (!queue) {
      let storage: Storage | undefined;
      try {
        storage = localStorage;
      } catch {}
      queue = new EventQueue(`cco_${app}:${current.scopeTag}`, endpoint, send, "granted", {
        storage,
      });
      queue.setInitialConsent("granted");
      teardown = installCapture(
        { enqueue: emit, flush: (beacon: boolean) => queue?.flush(beacon) } as EventQueue,
        { structural: true },
      );
    }
  } catch {
    /* Retain retryable evidence; never report a successful delivery. */
  } finally {
    busy = false;
    if (active && epoch === runEpoch) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 60000);
    }
  }
}
function beginRequest(url: string, _method?: string): { traceparent: string; id: string } | null {
  if (!active || !queue || privacySignal() || pending.size >= 200) return null;
  try {
    const parsed = new URL(url, location.origin);
    if (parsed.origin !== new URL(endpoint).origin || /\/cco(?:\/|$)/.test(parsed.pathname))
      return null;
    const traceId = id();
    const spanId = id().slice(0, 16);
    const eventId = `req_${id()}`;
    pending.set(eventId, { traceId, spanId, path: path(parsed.pathname) });
    emit({
      eventId,
      type: "track",
      ts: Date.now(),
      path: parsed.pathname,
      props: { name: "cco_request" },
      traceContext: { traceId, spanId },
    });
    return { traceparent: `00-${traceId}-${spanId}-01`, id: eventId };
  } catch {
    return null;
  }
}
function endRequest(eventId: string, status: number | null): void {
  const p = pending.get(eventId);
  if (!p) return;
  pending.delete(eventId);
  emit({
    type: "track",
    ts: Date.now(),
    path: p.path,
    props: {
      name: status === null ? "cco_network_failure" : "cco_response",
      ...(status !== null && status >= 100 && status <= 599 ? { statusCode: status } : {}),
    },
    traceContext: { traceId: p.traceId, spanId: p.spanId },
  });
}
async function tracedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  if (headers.has("traceparent")) return originalFetch(input, init);
  const trace = beginRequest(url, init?.method);
  if (!trace) return originalFetch(input, init);
  // Preserve redirect semantics. Following redirects must not leak correlation to another origin.
  const policy = init?.redirect ?? (input instanceof Request ? input.redirect : "follow");
  if (policy === "error" || policy === "manual") headers.set("traceparent", trace.traceparent);
  try {
    const response = await originalFetch(input, { ...init, headers });
    endRequest(trace.id, response.status);
    return response;
  } catch (error) {
    endRequest(trace.id, null);
    throw error;
  }
}
if (safeConfig() && !win.vertexCco) {
  win.vertexCco = { consent, refresh, reset, beginRequest, endRequest, fetch: tracedFetch };
  window.addEventListener("vertex:cco-consent", (event) =>
    consent((event as CustomEvent).detail === true),
  );
  window.addEventListener("online", () => {
    queue?.online();
    void refresh();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key && event.newValue === null && active) stop();
  });
  if (win.__VERTEX_CCO_CONSENT__ === true && !privacySignal()) consent(true);
}
