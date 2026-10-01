import type { TrackiClient } from "@io7i/tracki-mobile-core";

/** Hash only numeric locations in recognized bundle frames. Messages, function
 * names, paths and arbitrary source text are neither hashed nor emitted. */
export function normalizedErrorFingerprint(error: unknown): string | undefined {
  let stack: unknown;
  try { stack = error && typeof error === "object" ? (error as { stack?: unknown }).stack : undefined; } catch { return undefined; }
  if (typeof stack !== "string") return undefined;
  const frames = stack.slice(0, 16384).split("\n").slice(1, 33).flatMap(line => {
    const frame = line.match(/(?:^|[\s/@\\(])(index|main|app|bundle)(?:\.(android|ios))?\.(bundle|js):(\d{1,7}):(\d{1,7})(?:\)|\s|$)/);
    return frame ? [`${frame[1]}.${frame[2] ?? "neutral"}.${frame[3]}:${frame[4]}:${frame[5]}`] : [];
  }).slice(0, 8);
  if (!frames.length) return undefined;
  const text = frames.join("|");
  // Four independently seeded FNV lanes; an opaque grouping key, not a secret.
  return [2166136261, 2246822507, 3266489909, 668265263].map(seed => {
    let h = seed; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0).toString(16).padStart(8, "0");
  }).join("");
}
type ErrorClient = Pick<TrackiClient, "error"> & Partial<Pick<TrackiClient, "diagnostic">>;
function emitError(client: ErrorClient, code: string, error?: unknown): void {
  const fingerprint = normalizedErrorFingerprint(error);
  if (client.diagnostic && fingerprint) client.diagnostic({ type: "error", ts: Date.now(), props: { code }, fingerprint });
  else client.error(code);
}

/** React Native's ErrorUtils seam. Error values are passed only to the original handler. */
export interface JavaScriptErrorSource {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

/** Observe fixed diagnostic codes without collecting messages, stacks, or user text. */
export function observeJavaScriptErrors(
  client: ErrorClient,
  source: JavaScriptErrorSource | undefined = (
    globalThis as typeof globalThis & { ErrorUtils?: JavaScriptErrorSource }
  ).ErrorUtils,
): () => void {
  if (!source) return () => {};
  const original = source.getGlobalHandler();
  let disposed = false;
  const observer = function (this: unknown, error: unknown, isFatal?: boolean) {
    try {
      if (!disposed) emitError(client, isFatal ? "JS_FATAL" : "JS_ERROR", error);
    } catch {
      // Diagnostics must never replace or prevent the host's error handling.
    } finally {
      original.call(this, error, isFatal);
    }
  };
  source.setGlobalHandler(observer);
  return () => {
    disposed = true;
    // Do not overwrite another tool's handler installed after ours.
    if (source.getGlobalHandler() === observer) source.setGlobalHandler(original);
  };
}

/** Host/platform seam. No Promise monkey-patch; install only where supported. */
export interface UnhandledRejectionSource {
  subscribe(listener: (reason: unknown) => void): () => void;
}
export function observeUnhandledRejections(client: ErrorClient, source?: UnhandledRejectionSource): () => void {
  if (!source) return () => {};
  let disposed = false;
  const unsubscribe = source.subscribe(reason => { if (!disposed) { try { emitError(client, "JS_ERROR", reason); } catch { /* host remains unaffected */ } } });
  return () => { if (!disposed) { disposed = true; unsubscribe(); } };
}

/** Host-owned crash integration: emits a code only; never receives crash payloads. */
export interface NativeCrashSource {
  subscribe(listener: () => void): () => void;
}

/** The host's existing crash provider supplies this seam; no recorder is installed. */
export function observeNativeCrashSignals(
  client: Pick<TrackiClient, "error">,
  source: NativeCrashSource,
): () => void {
  let disposed = false;
  const unsubscribe = source.subscribe(() => {
    if (disposed) return;
    try {
      client.error("NATIVE_CRASH");
    } catch {
      // A diagnostic observer cannot interfere with the host crash provider.
    }
  });
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
  };
}
