import type { Batch } from "./types";

/**
 * Send a batch to the ingest endpoint. Uses sendBeacon on page-hide (survives
 * unload), fetch+keepalive otherwise. Always fail-silent — never throws into
 * the host page.
 */
export function send(
  endpoint: string,
  batch: Batch,
  useBeacon: boolean,
  onResponse?: (data: unknown) => void,
): void {
  try {
    const body = JSON.stringify(batch);
    if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(endpoint, blob);
      return;
    }
    void fetch(endpoint, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      keepalive: true,
      mode: "cors",
      credentials: "omit",
    })
      .then((res) => (onResponse ? res.json() : null))
      .then((data) => {
        if (data && onResponse) onResponse(data);
      })
      .catch(() => {
        /* fail-silent */
      });
  } catch {
    /* fail-silent */
  }
}
