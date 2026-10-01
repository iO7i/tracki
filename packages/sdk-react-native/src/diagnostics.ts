import type { TrackiClient } from "@tracki/mobile-core";

/** React Native's ErrorUtils seam. Error values are passed only to the original handler. */
export interface JavaScriptErrorSource {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

/** Observe fixed diagnostic codes without collecting messages, stacks, or user text. */
export function observeJavaScriptErrors(
  client: Pick<TrackiClient, "error">,
  source: JavaScriptErrorSource | undefined = (
    globalThis as typeof globalThis & { ErrorUtils?: JavaScriptErrorSource }
  ).ErrorUtils,
): () => void {
  if (!source) return () => {};
  const original = source.getGlobalHandler();
  let disposed = false;
  const observer = function (this: unknown, error: unknown, isFatal?: boolean) {
    try {
      if (!disposed) client.error(isFatal ? "JS_FATAL" : "JS_ERROR");
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
