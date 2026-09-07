import { describe, expect, it } from "vitest";
import { createTracki, screenPath } from "./client";
import { SESSION_TIMEOUT_MS } from "./identity";
import type { Batch, KeyValueStorage, RenderIntent, TrackiConfig, Transport } from "./types";

// ── Test doubles ─────────────────────────────────────────────────────────────

function memoryStorage(seed: Record<string, string> = {}): KeyValueStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(seed));
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => {
      data.set(k, v);
    },
  };
}

interface Call {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
}

function fakeTransport(routes: Record<string, unknown> = {}): Transport & { calls: Call[] } {
  const calls: Call[] = [];
  const match = (url: string) => {
    for (const [prefix, resp] of Object.entries(routes)) {
      if (url.includes(prefix)) return resp;
    }
    return {};
  };
  return {
    calls,
    post: async (url, body) => {
      calls.push({ method: "POST", url, body });
      return match(url);
    },
    get: async (url) => {
      calls.push({ method: "GET", url });
      return match(url);
    },
  };
}

function makeClock(start = 1_700_000_000_000) {
  let t = start;
  const clock = () => t;
  clock.advance = (ms: number) => {
    t += ms;
  };
  return clock;
}

let idSeq = 0;
const testIds = (prefix: string) => `${prefix}_${++idSeq}`;

async function makeClient(overrides: Partial<TrackiConfig> = {}) {
  // Honor overrides so tests that inject their own doubles read the right ones back.
  const storage = (overrides.storage ?? memoryStorage()) as ReturnType<typeof memoryStorage>;
  const transport = (overrides.transport ?? fakeTransport()) as ReturnType<typeof fakeTransport>;
  const clock = makeClock();
  const intents: RenderIntent[] = [];
  const opened: string[] = [];
  const client = await createTracki({
    key: "pk_test",
    endpoint: "https://ingest.test",
    device: { platform: "ios", osVersion: "17.4", appVersion: "2.1.0", sdk: "react-native" },
    locale: "en",
    clock,
    idFactory: testIds,
    renderer: { show: (i) => intents.push(i) },
    openUrl: (u) => opened.push(u),
    ...overrides,
    storage,
    transport,
  });
  await client.ready;
  return { client, storage, transport, clock, intents, opened };
}

function sentBatches(transport: { calls: Call[] }): Batch[] {
  return transport.calls
    .filter((c) => c.method === "POST" && c.url.includes("/v1/events"))
    .map((c) => c.body as Batch);
}

async function flushedEvents(ctx: {
  client: { flush(): Promise<void> };
  transport: { calls: Call[] };
}) {
  await ctx.client.flush();
  return sentBatches(ctx.transport).flatMap((b) => b.events);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("screenPath", () => {
  it("normalizes names to a leading-slash path", () => {
    expect(screenPath("Checkout")).toBe("/Checkout");
    expect(screenPath("  loan application ")).toBe("/loan-application");
    expect(screenPath("/payment")).toBe("/payment");
  });
});

describe("wire format", () => {
  it("sends the exact /v1/events envelope with the device block", async () => {
    const ctx = await makeClient();
    ctx.client.screen("Home");
    await ctx.client.flush();
    const [batch] = sentBatches(ctx.transport);
    expect(batch).toBeDefined();
    if (!batch) return;
    expect(batch.key).toBe("pk_test");
    expect(batch.anonId).toMatch(/^anon_/);
    expect(batch.sessionId).toMatch(/^sess_/);
    expect(batch.sentAt).toBeGreaterThan(0);
    expect(batch.device).toEqual({
      platform: "ios",
      osVersion: "17.4",
      appVersion: "2.1.0",
      sdk: "react-native",
    });
    const types = batch.events.map((e) => e.type);
    expect(types).toContain("app_foreground"); // auto cold start
    expect(types).toContain("screen_view");
  });

  it("the auto cold start drives app_restart_loop detection", async () => {
    const ctx = await makeClient();
    const events = await flushedEvents(ctx);
    const fg = events.find((e) => e.type === "app_foreground");
    expect(fg?.props).toEqual({ launch: "cold" });
  });
});

describe("identity", () => {
  it("persists anon id across launches; sessions rotate after 30min idle", async () => {
    const storage = memoryStorage();
    const clock = makeClock();
    const a = await createTracki({
      key: "pk_t",
      endpoint: "https://i.test",
      device: { platform: "android" },
      storage,
      transport: fakeTransport(),
      clock,
      idFactory: testIds,
    });
    const anon1 = a.anonId();
    const sess1 = a.sessionId();
    clock.advance(SESSION_TIMEOUT_MS + 1);
    const b = await createTracki({
      key: "pk_t",
      endpoint: "https://i.test",
      device: { platform: "android" },
      storage,
      transport: fakeTransport(),
      clock,
      idFactory: testIds,
    });
    expect(b.anonId()).toBe(anon1); // anon persists
    expect(b.sessionId()).not.toBe(sess1); // session rotated
  });

  it("identify stores the user id and stamps subsequent batches", async () => {
    const ctx = await makeClient();
    ctx.client.identify("user_42");
    await ctx.client.flush();
    const [batch] = sentBatches(ctx.transport);
    expect(batch?.userId).toBe("user_42");
    expect(batch?.events.some((e) => e.type === "identify")).toBe(true);
    expect(ctx.storage.data.get("tracki_user")).toBe("user_42");
  });
});

describe("screen tracking", () => {
  it("emits screen_view with path; screen_leave carries the duration; referrer is the previous screen", async () => {
    const ctx = await makeClient();
    ctx.client.screen("Home");
    ctx.clock.advance(4200);
    ctx.client.screen("Checkout");
    const events = await flushedEvents(ctx);
    const views = events.filter((e) => e.type === "screen_view");
    expect(views.map((v) => v.path)).toEqual(["/Home", "/Checkout"]);
    expect(views[1]?.referrer).toBe("/Home");
    const leave = events.find((e) => e.type === "screen_leave");
    expect(leave?.path).toBe("/Home");
    expect(leave?.props).toEqual({ durationMs: 4200 });
  });
});

describe("mobile event API", () => {
  it("builds the full vocabulary with the right types and props", async () => {
    const ctx = await makeClient();
    ctx.client.screen("Payment");
    ctx.client.otp("fail");
    ctx.client.biometric("success");
    ctx.client.payment("fail", { method: "visa" });
    ctx.client.flow("abandon", "checkout");
    ctx.client.permissionDenied("camera");
    ctx.client.deepLink("app://promo", false);
    ctx.client.pushOpen({ campaign: "eid" });
    ctx.client.backNav();
    ctx.client.error("boom");
    ctx.client.track("purchase", { amount: 100 });
    const events = await flushedEvents(ctx);
    const byType = Object.fromEntries(events.map((e) => [e.type, e]));
    expect(byType.otp_fail).toBeDefined();
    expect(byType.biometric_success).toBeDefined();
    expect(byType.payment_fail?.props).toEqual({ method: "visa" });
    expect(byType.flow_abandon?.props).toEqual({ flow: "checkout" });
    expect(byType.permission_denied?.props).toEqual({ permission: "camera" });
    expect(byType.deep_link?.props).toEqual({ url: "app://promo", ok: false });
    expect(byType.push_open?.props).toEqual({ campaign: "eid" });
    expect(byType.back_nav).toBeDefined();
    expect(byType.error?.props).toEqual({ message: "boom" });
    expect(byType.track?.props).toEqual({ amount: 100, name: "purchase" });
    // every event is stamped with the current screen
    expect(byType.otp_fail?.path).toBe("/Payment");
  });
});

describe("queue", () => {
  it("auto-flushes at 10 events and splits oversized buffers at 50", async () => {
    const ctx = await makeClient();
    for (let i = 0; i < 9; i++) ctx.client.track(`e${i}`);
    // 1 auto cold-start + 9 = 10 → size-triggered flush
    await ctx.client.flush();
    expect(sentBatches(ctx.transport).length).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 60; i++) ctx.client.track(`big${i}`);
    await ctx.client.flush();
    for (const b of sentBatches(ctx.transport)) {
      expect(b.events.length).toBeLessThanOrEqual(50);
    }
  });
});

// ── Action engine ────────────────────────────────────────────────────────────

const manifestAction = {
  id: "act-1",
  type: "popup" as const,
  content: {
    ar: { title: "مساعدة", body: "هل تحتاج مساعدة؟", cta: { label: "واتساب", kind: "whatsapp" } },
    en: { title: "Help", body: "Need help?", cta: { label: "WhatsApp", kind: "whatsapp" } },
  },
  trigger: { kind: "pageview" },
  urlContains: "Checkout",
  frequencyCap: 2,
  goalEvent: "purchase",
};

describe("action engine", () => {
  it("fetches the mobile-surface manifest and shows on a matching screen only", async () => {
    const transport = fakeTransport({
      "/v1/actions": { actions: [manifestAction] },
      "/v1/handoff": { deepLink: "https://wa.me/9665?text=TR-1" },
    });
    const ctx = await makeClient({ transport });
    const manifestCall = transport.calls.find((c) => c.url.includes("/v1/actions"));
    expect(manifestCall?.url).toContain("surface=mobile");

    ctx.client.screen("Home");
    expect(ctx.intents.filter((i) => i.intent === "action")).toHaveLength(0);
    ctx.client.screen("Checkout");
    const acts = ctx.intents.filter((i) => i.intent === "action");
    expect(acts).toHaveLength(1);
    if (acts[0]?.intent !== "action") return;
    expect(acts[0].content.title).toBe("Help"); // locale-resolved (en)
    expect(acts[0].type).toBe("popup");

    // impression emitted
    const events = await flushedEvents(ctx);
    const imp = events.find((e) => e.type === "action_impression");
    expect(imp?.props).toMatchObject({ action_id: "act-1", variant: "A" });
  });

  it("CTA activation routes WhatsApp through a real handoff and emits action_click", async () => {
    const transport = fakeTransport({
      "/v1/actions": { actions: [manifestAction] },
      "/v1/handoff": { deepLink: "https://wa.me/9665?text=TR-1" },
    });
    const ctx = await makeClient({ transport });
    ctx.client.screen("Checkout");
    const act = ctx.intents.find((i) => i.intent === "action");
    if (act?.intent !== "action") throw new Error("no action intent");
    act.activateCta();
    await new Promise((r) => setTimeout(r, 0)); // let the handoff promise settle
    expect(ctx.opened).toEqual(["https://wa.me/9665?text=TR-1"]);
    const events = await flushedEvents(ctx);
    const click = events.find((e) => e.type === "action_click");
    expect(click?.props).toMatchObject({ channel: "whatsapp" });
  });

  it("honors the frequency cap across launches (storage-persisted)", async () => {
    const storage = memoryStorage();
    const mk = async () => {
      const transport = fakeTransport({ "/v1/actions": { actions: [manifestAction] } });
      return makeClient({ storage, transport });
    };
    const a = await mk();
    a.client.screen("Checkout");
    a.client.screen("Home");
    a.client.screen("Checkout"); // 2nd show (cap = 2)
    expect(a.intents.filter((i) => i.intent === "action")).toHaveLength(2);
    const b = await mk(); // new launch, same storage
    b.client.screen("Checkout");
    expect(b.intents.filter((i) => i.intent === "action")).toHaveLength(0); // capped
  });

  it("fires the goal only after the action was shown this session", async () => {
    const transport = fakeTransport({ "/v1/actions": { actions: [manifestAction] } });
    const ctx = await makeClient({ transport });
    ctx.client.track("purchase"); // not shown yet → no goal
    ctx.client.screen("Checkout"); // shows
    ctx.client.track("purchase"); // → goal
    const events = await flushedEvents(ctx);
    expect(events.filter((e) => e.type === "action_goal")).toHaveLength(1);
  });

  it("resolves guided-tour steps for the configured locale", async () => {
    const tour = {
      id: "act-tour",
      type: "tour" as const,
      content: { ar: { title: "جولة", body: "" }, en: { title: "Tour", body: "" } },
      trigger: { kind: "pageview" },
      steps: [
        {
          ar: { title: "الخطوة ١", body: "وصف" },
          en: { title: "Step 1", body: "Desc" },
          anchor: "fab",
        },
      ],
    };
    const transport = fakeTransport({ "/v1/actions": { actions: [tour] } });
    const ctx = await makeClient({ transport, locale: "ar" });
    ctx.client.screen("Home");
    const intent = ctx.intents.find((i) => i.intent === "action");
    if (intent?.intent !== "action") throw new Error("no tour intent");
    expect(intent.type).toBe("tour");
    expect(intent.steps).toEqual([{ title: "الخطوة ١", body: "وصف", anchor: "fab" }]);
  });

  it("a throwing renderer never counts an impression (implementation M1 parity)", async () => {
    const transport = fakeTransport({ "/v1/actions": { actions: [manifestAction] } });
    const ctx = await makeClient({
      transport,
      renderer: {
        show: () => {
          throw new Error("render fail");
        },
      },
    });
    ctx.client.screen("Checkout");
    const events = await flushedEvents(ctx);
    expect(events.filter((e) => e.type === "action_impression")).toHaveLength(0);
  });

  it("exit_intent actions show on app background", async () => {
    const exit = {
      ...manifestAction,
      id: "act-exit",
      trigger: { kind: "exit_intent" },
      urlContains: undefined,
    };
    const transport = fakeTransport({ "/v1/actions": { actions: [exit] } });
    const ctx = await makeClient({ transport });
    ctx.client.screen("Home");
    ctx.client.appBackground();
    expect(ctx.intents.filter((i) => i.intent === "action")).toHaveLength(1);
  });
});

// ── Live Assist ──────────────────────────────────────────────────────────────

const assistPayload = {
  actionId: "assist-1",
  mode: "answer" as const,
  confidence: 0.9,
  content: {
    ar: { title: "مساعدة", body: "جرّب هذا", cta: { label: "واتساب", kind: "whatsapp" } },
    en: { title: "Help", body: "Try this", cta: { label: "WhatsApp", kind: "whatsapp" } },
  },
  article: {
    ar: { title: "كيف تستلم الرمز", body: "تأكد من رقمك" },
    en: { title: "Receiving your code", body: "Check your number" },
  },
  articleId: "faq-9",
};

describe("live assist", () => {
  it("renders the assist from an events response, once per session, and emits telemetry", async () => {
    const transport = fakeTransport({ "/v1/events": { ok: true, assist: assistPayload } });
    const ctx = await makeClient({ transport });
    ctx.client.screen("Otp");
    await ctx.client.flush();
    const assists = ctx.intents.filter((i) => i.intent === "assist");
    expect(assists).toHaveLength(1);
    if (assists[0]?.intent !== "assist") return;
    expect(assists[0].title).toBe("Receiving your code"); // answer mode → FAQ
    expect(assists[0].ctaLabel).toBe("WhatsApp");

    assists[0].helpful();
    await ctx.client.flush();
    const events = sentBatches(ctx.transport).flatMap((b) => b.events);
    expect(events.some((e) => e.type === "assist_shown")).toBe(true);
    const helpful = events.find((e) => e.type === "assist_helpful");
    expect(helpful?.props).toMatchObject({ action_id: "assist-1", article_id: "faq-9" });

    // the same assist payload arriving again is ignored (once per session)
    ctx.client.track("x");
    await ctx.client.flush();
    expect(ctx.intents.filter((i) => i.intent === "assist")).toHaveLength(1);
  });

  it("escalate routes the authored CTA channel (whatsapp → handoff + openUrl)", async () => {
    const transport = fakeTransport({
      "/v1/events": { ok: true, assist: assistPayload },
      "/v1/handoff": { deepLink: "https://wa.me/9665?text=TR-2" },
    });
    const ctx = await makeClient({ transport });
    ctx.client.screen("Otp");
    await ctx.client.flush();
    const assist = ctx.intents.find((i) => i.intent === "assist");
    if (assist?.intent !== "assist") throw new Error("no assist");
    assist.escalate();
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.opened).toEqual(["https://wa.me/9665?text=TR-2"]);
  });
});

// ── Channels ─────────────────────────────────────────────────────────────────

describe("channels", () => {
  it("chat keeps the conversation id across turns", async () => {
    const transport = fakeTransport({
      "/v1/chat": {
        conversationId: "11111111-1111-4111-8111-111111111111",
        reply: "أهلاً",
        escalate: false,
      },
    });
    const ctx = await makeClient({ transport });
    ctx.client.openChat();
    const chat = ctx.intents.find((i) => i.intent === "chat");
    if (chat?.intent !== "chat") throw new Error("no chat intent");
    await chat.send("كيف أستلم الرمز؟");
    await chat.send("لم يصلني");
    const chatCalls = ctx.transport.calls.filter((c) => c.url.includes("/v1/chat"));
    expect(chatCalls).toHaveLength(2);
    expect((chatCalls[1]?.body as { conversationId?: string }).conversationId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("faq launch pre-fetches published articles", async () => {
    const transport = fakeTransport({
      "/v1/faq": { articles: [{ id: "a1", title: "كيف؟", body: "هكذا" }] },
    });
    const ctx = await makeClient({ transport });
    ctx.client.openFaq();
    await new Promise((r) => setTimeout(r, 0));
    const faq = ctx.intents.find((i) => i.intent === "faq");
    if (faq?.intent !== "faq") throw new Error("no faq intent");
    expect(faq.articles).toHaveLength(1);
  });
});
