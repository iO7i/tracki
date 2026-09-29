import type { EventQueue } from "./queue";
function hex(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return Array.from(value, (x) => x.toString(16).padStart(2, "0")).join("");
}
/** Explicit same-origin non-redirecting calls only; never globally patches fetch. */
export async function tracedFetch(
  queue: EventQueue,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  consentGranted: boolean,
): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (!consentGranted || url.origin !== location.origin) return fetch(input, init);
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  if (headers.has("traceparent")) return fetch(input, init);
  const traceId = hex(16);
  const parent = hex(8);
  headers.set("traceparent", `00-${traceId}-${parent}-01`);
  queue.enqueue({
    type: "track",
    ts: Date.now(),
    path: url.pathname,
    traceContext: { traceId, spanId: parent },
    props: { name: "cco_request" },
  });
  try {
    const response = await fetch(input, { ...init, headers, redirect: "error" });
    queue.enqueue({
      type: "track",
      ts: Date.now(),
      path: url.pathname,
      traceContext: { traceId, spanId: hex(8), parentSpanId: parent },
      props: { name: "cco_response", statusCode: response.status },
    });
    return response;
  } catch (error) {
    queue.enqueue({
      type: "track",
      ts: Date.now(),
      path: url.pathname,
      traceContext: { traceId, spanId: hex(8), parentSpanId: parent },
      props: { name: "cco_network_failure" },
    });
    throw error;
  }
}
