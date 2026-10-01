import type { Transport } from "./types";

export class TransportHttpError extends Error {
  constructor(readonly status: number) {
    super(`Tracki transport HTTP ${status}`);
    this.name = "TransportHttpError";
  }
}

/** Never treat an HTTP failure or malformed response as an acknowledgment. */
export function fetchTransport(): Transport {
  const read = async (response: Response): Promise<unknown> => {
    if (!response.ok) throw new TransportHttpError(response.status);
    return response.json();
  };
  const request = async (url: string, init?: Parameters<typeof fetch>[1]): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      return await read(await fetch(url, { ...init, signal: controller.signal }));
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    async post(url: string, body: unknown): Promise<unknown> {
      return request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    async get(url: string): Promise<unknown> {
      return request(url);
    },
  };
}
