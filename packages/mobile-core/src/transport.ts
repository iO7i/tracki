import type { Transport } from "./types";

/** Default fetch transport. Fail-silent callers decide what to do with errors. */
export function fetchTransport(): Transport {
  return {
    async post(url: string, body: unknown): Promise<unknown> {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      try {
        return await r.json();
      } catch {
        return undefined;
      }
    },
    async get(url: string): Promise<unknown> {
      const r = await fetch(url);
      try {
        return await r.json();
      } catch {
        return undefined;
      }
    },
  };
}
