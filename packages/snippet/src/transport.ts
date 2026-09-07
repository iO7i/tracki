import type { Batch } from "./types";

/** A queued beacon is not a server acknowledgment. Preserve it for retry. */
export async function send(
  endpoint: string,
  batch: Batch,
  useBeacon: boolean,
  onResponse?: (data: unknown) => void,
): Promise<boolean> {
  const body = JSON.stringify(batch);
  if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      if (navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" })))
        return false;
    } catch {
      /* fall back to fetch when rejected */
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      keepalive: true,
      mode: "cors",
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    // Response parsing/widget failure must not invalidate an acknowledged write.
    try {
      onResponse?.(await response.json());
    } catch {
      /* optional assistance */
    }
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
