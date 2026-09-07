import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTracki } from "./client";
import type { Batch, ChatIntent, KeyValueStorage, Transport } from "./types";

/**
 * The TS reference implementation must reproduce the shared conformance
 * fixtures byte-for-byte (as parsed JSON). The Flutter/Swift/Kotlin SDKs
 * assert the SAME files — this is what keeps four codebases on one protocol.
 */

const dir = join(__dirname, "../../../sdks/conformance");
const journey = JSON.parse(readFileSync(join(dir, "journey-batch.json"), "utf8"));
const channels = JSON.parse(readFileSync(join(dir, "channel-requests.json"), "utf8"));

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => {
      data.set(k, v);
    },
  };
}

function capturingTransport(): Transport & { posts: Array<{ url: string; body: unknown }> } {
  const posts: Array<{ url: string; body: unknown }> = [];
  return {
    posts,
    post: async (url, body) => {
      // Serialize exactly like a real HTTP transport would (drops undefineds).
      posts.push({ url, body: JSON.parse(JSON.stringify(body)) });
      return { ok: true };
    },
    get: async () => ({ actions: [] }),
  };
}

async function runJourney() {
  let t = 1_700_000_000_000;
  const counters: Record<string, number> = {};
  const nextId = (prefix: string) => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return `${prefix}_${counters[prefix]}`;
  };
  const transport = capturingTransport();
  const client = await createTracki({
    key: journey.config.key,
    endpoint: journey.config.endpoint,
    locale: journey.config.locale,
    device: journey.config.device,
    storage: memoryStorage(),
    transport,
    clock: () => t,
    idFactory: nextId,
  });
  await client.ready;
  for (const step of journey.script as Array<{ call: string; args: unknown[] }>) {
    t += 1000; // the fixture clock: +1000ms before each step
    (client as unknown as Record<string, (...a: unknown[]) => void>)[step.call]?.(...step.args);
  }
  await client.flush();
  return { client, transport };
}

describe("conformance: journey-batch.json", () => {
  it("produces exactly the expected /v1/events batch", async () => {
    const { transport } = await runJourney();
    const batches = transport.posts.filter((p) => p.url.endsWith("/v1/events"));
    expect(batches).toHaveLength(1);
    expect(batches[0]?.body as Batch).toEqual(journey.expectedBatch);
  });
});

describe("conformance: channel-requests.json", () => {
  it("mints the exact WhatsApp handoff body", async () => {
    const { client, transport } = await runJourney();
    client.openWhatsApp();
    await new Promise((r) => setTimeout(r, 0));
    const handoff = transport.posts.find((p) => p.url.endsWith(channels.whatsappHandoff.url));
    expect(handoff?.body).toEqual(channels.whatsappHandoff.body);
  });

  it("sends the exact first chat turn", async () => {
    const intents: unknown[] = [];
    let t = 1_700_000_000_000;
    const counters: Record<string, number> = {};
    const nextId = (prefix: string) => {
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      return `${prefix}_${counters[prefix]}`;
    };
    const transport = capturingTransport();
    const client = await createTracki({
      key: journey.config.key,
      endpoint: journey.config.endpoint,
      locale: journey.config.locale,
      device: journey.config.device,
      storage: memoryStorage(),
      transport,
      clock: () => t,
      idFactory: nextId,
      renderer: { show: (i) => intents.push(i) },
    });
    await client.ready;
    for (const step of journey.script as Array<{ call: string; args: unknown[] }>) {
      t += 1000;
      (client as unknown as Record<string, (...a: unknown[]) => void>)[step.call]?.(...step.args);
    }
    client.openChat();
    const chat = intents.find((i) => (i as { intent?: string }).intent === "chat") as ChatIntent;
    await chat.send(channels.chatFirstTurn.messageUsed);
    const turn = transport.posts.find((p) => p.url.endsWith(channels.chatFirstTurn.url));
    expect(turn?.body).toEqual(channels.chatFirstTurn.body);
  });
});
