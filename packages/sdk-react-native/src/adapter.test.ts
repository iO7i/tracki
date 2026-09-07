import type { KeyValueStorage, RenderIntent } from "@tracki/mobile-core";
import { describe, expect, it } from "vitest";
import { type NativeBindings, createIntentBus, createTrackiClient } from "./adapter";

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => {
      data.set(k, v);
    },
  };
}

function fakeNative() {
  let appStateHandler: ((s: "active" | "background") => void) | undefined;
  let backHandler: (() => void) | undefined;
  let deepLinkHandler: ((url: string) => void) | undefined;
  const opened: string[] = [];
  const bindings: NativeBindings = {
    storage: memoryStorage(),
    platform: "android",
    osVersion: "14",
    openUrl: (u) => opened.push(u),
    onAppStateChange: (h) => {
      appStateHandler = h;
      return () => {
        appStateHandler = undefined;
      };
    },
    onBackPress: (h) => {
      backHandler = h;
      return () => {
        backHandler = undefined;
      };
    },
    onDeepLink: (h) => {
      deepLinkHandler = h;
      return () => {
        deepLinkHandler = undefined;
      };
    },
  };
  return {
    bindings,
    opened,
    fireAppState: (s: "active" | "background") => appStateHandler?.(s),
    fireBack: () => backHandler?.(),
    fireDeepLink: (url: string) => deepLinkHandler?.(url),
    isWired: () => !!appStateHandler && !!backHandler && !!deepLinkHandler,
  };
}

function fakeTransport() {
  const posts: Array<{ url: string; body: unknown }> = [];
  return {
    posts,
    post: async (url: string, body: unknown) => {
      posts.push({ url, body: JSON.parse(JSON.stringify(body)) });
      return { ok: true };
    },
    get: async () => ({ actions: [] }),
  };
}

describe("createTrackiClient (React Native adapter)", () => {
  it("stamps the react-native device block and wires lifecycle/back/deep-link", async () => {
    const native = fakeNative();
    const transport = fakeTransport();
    const { client, dispose } = await createTrackiClient(
      { key: "pk_rn", endpoint: "https://i.test", appVersion: "1.4.0", transport },
      native.bindings,
    );
    await client.ready;
    expect(native.isWired()).toBe(true);

    client.screen("Home");
    native.fireBack();
    native.fireDeepLink("app://promo");
    native.fireAppState("background"); // → app_background + flush
    await client.flush();

    const events = transport.posts
      .filter((p) => p.url.includes("/v1/events"))
      .flatMap((p) => (p.body as { events: Array<{ type: string }> }).events);
    const types = events.map((e) => e.type);
    expect(types).toContain("back_nav");
    expect(types).toContain("deep_link");
    expect(types).toContain("app_background");

    const batch = transport.posts.find((p) => p.url.includes("/v1/events"))?.body as {
      device: Record<string, unknown>;
    };
    expect(batch.device).toEqual({
      platform: "android",
      osVersion: "14",
      appVersion: "1.4.0",
      sdk: "react-native",
    });

    // warm foreground on re-activation
    native.fireAppState("active");
    await client.flush();
    const all = transport.posts
      .filter((p) => p.url.includes("/v1/events"))
      .flatMap(
        (p) => (p.body as { events: Array<{ type: string; props?: { launch?: string } }> }).events,
      );
    expect(all.some((e) => e.type === "app_foreground" && e.props?.launch === "warm")).toBe(true);

    dispose();
    expect(native.isWired()).toBe(false);
  });
});

describe("intent bus", () => {
  it("queues intents until a subscriber attaches, then streams live", () => {
    const bus = createIntentBus();
    const early = { intent: "faq", articles: [], search: async () => [] } as RenderIntent;
    bus.show(early);
    const seen: RenderIntent[] = [];
    const off = bus.subscribe((i) => seen.push(i));
    expect(seen).toEqual([early]); // drained the pending intent
    const live = { intent: "faq", articles: [], search: async () => [] } as RenderIntent;
    bus.show(live);
    expect(seen).toHaveLength(2);
    off();
    bus.show(live);
    expect(seen).toHaveLength(2);
  });
});
