import { actionDefinitionSchema, actionProposalDraftSchema } from "@tracki/shared";
import { describe, expect, it } from "vitest";
import {
  type ActionSeed,
  MAX_SEEDS,
  type StudioFrictionRow,
  draftActionFromSeed,
  matchFaqForSeed,
  proposeSeeds,
  suggestChannel,
} from "./autopilot";
import type { ActionCopyDraft, LLMClient } from "./llm";
import { HeuristicClient } from "./llm";
import type { DraftActionInput } from "./prompts";

const row = (over: Partial<StudioFrictionRow> = {}): StudioFrictionRow => ({
  path: "/checkout",
  struggleType: "rage_click",
  count: 5,
  score: 78,
  ...over,
});

describe("proposeSeeds", () => {
  it("ranks by friction score and is deterministic", () => {
    const a = proposeSeeds([
      row({ path: "/help", score: 30, struggleType: "thrashing" }),
      row({ path: "/checkout", score: 78 }),
      row({ path: "/signup", score: 50, struggleType: "form_abandon" }),
    ]);
    expect(a.map((s) => s.evidence.path)).toEqual(["/checkout", "/signup", "/help"]);
    const b = proposeSeeds([
      row({ path: "/signup", score: 50, struggleType: "form_abandon" }),
      row({ path: "/checkout", score: 78 }),
      row({ path: "/help", score: 30, struggleType: "thrashing" }),
    ]);
    expect(b).toEqual(a);
  });

  it("filters noise: low counts, empty paths, unknown struggle types", () => {
    const seeds = proposeSeeds([
      row({ count: 1 }),
      row({ path: "" }),
      row({ struggleType: "pogo_stick" }),
    ]);
    expect(seeds).toEqual([]);
  });

  it("dedupes by path|type and caps at max", () => {
    const seeds = proposeSeeds([
      row(),
      row(),
      ...Array.from({ length: 10 }, (_, i) => row({ path: `/p${i}` })),
    ]);
    expect(seeds.length).toBe(MAX_SEEDS);
    expect(new Set(seeds.map((s) => s.seedKey)).size).toBe(seeds.length);
  });

  it("attaches a VoC gap question whose tokens overlap the path", () => {
    const seeds = proposeSeeds(
      [row({ path: "/shipping" })],
      [
        { question: "متى يصل الطلب؟", count: 4 },
        { question: "what are the shipping options", count: 3 },
      ],
    );
    expect(seeds[0]?.evidence.gapQuestion).toBe("what are the shipping options");
  });
});

describe("suggestChannel (right channeling)", () => {
  const ev = (path: string, score: number) => ({
    path,
    struggleType: "rage_click",
    count: 5,
    score,
  });
  it("a grounding FAQ wins (self-service first)", () => {
    expect(suggestChannel(ev("/checkout", 90), true)).toBe("faq");
  });
  it("high-friction high-intent paths go to WhatsApp", () => {
    expect(suggestChannel(ev("/checkout", 78), false)).toBe("whatsapp");
    expect(suggestChannel(ev("/payment/methods", 60), false)).toBe("whatsapp");
  });
  it("everything else opens the on-site chat", () => {
    expect(suggestChannel(ev("/checkout", 40), false)).toBe("chat"); // below floor
    expect(suggestChannel(ev("/help", 90), false)).toBe("chat"); // not high-intent
  });
});

describe("matchFaqForSeed", () => {
  const seed: ActionSeed = {
    seedKey: "/shipping|thrashing",
    evidence: { path: "/shipping", struggleType: "thrashing", count: 3, score: 40 },
  };
  const faq = {
    id: "a1",
    titleAr: "الشحن والتوصيل",
    bodyAr: "تفاصيل الشحن",
    titleEn: "Shipping and delivery",
    bodyEn: "Shipping details",
  };
  it("matches on token overlap", () => {
    expect(matchFaqForSeed(seed, [faq])?.id).toBe("a1");
  });
  it("never forces a match", () => {
    expect(
      matchFaqForSeed(seed, [
        { ...faq, titleEn: "Refund policy", bodyEn: "Refunds", titleAr: "x", bodyAr: "y" },
      ]),
    ).toBeUndefined();
  });
});

describe("draftActionFromSeed (offline playbook)", () => {
  const heuristic = new HeuristicClient();

  it("drafts a full, schema-valid bilingual action — never a stub, deterministic", async () => {
    const [seed] = proposeSeeds([row()]);
    const a = await draftActionFromSeed(seed as ActionSeed, [], heuristic);
    const b = await draftActionFromSeed(seed as ActionSeed, [], heuristic);
    expect(a).toEqual(b);
    expect(actionProposalDraftSchema.safeParse(a.draft).success).toBe(true);
    expect(a.draft.definition.content.ar.title.length).toBeGreaterThan(0);
    expect(a.draft.definition.content.ar.body).not.toContain("مراجعة بشرية"); // not a review stub
    expect(a.draft.definition.content.en.cta?.kind).toBe("whatsapp"); // 78 on /checkout
    expect(a.draft.definition.goalEvent).toBe("purchase");
    expect(a.draft.definition.trigger.kind).toBe("rage_click"); // instant client trigger
    expect(a.draft.definition.urlContains).toBe("/checkout");
  });

  it("non-rage struggle types deliver via the server (Live Assist)", async () => {
    const [seed] = proposeSeeds([
      row({ struggleType: "form_abandon", path: "/signup", score: 45 }),
    ]);
    const { draft } = await draftActionFromSeed(seed as ActionSeed, [], heuristic);
    expect(draft.definition.trigger.kind).toBe("struggle");
    expect(draft.definition.struggleTypes).toEqual(["form_abandon"]);
    expect(draft.definition.content.en.cta?.kind).toBe("chat"); // not high-intent
  });

  it("strips query strings from urlContains targeting", async () => {
    const [seed] = proposeSeeds([row({ path: "/checkout?step=2" })]);
    const { draft } = await draftActionFromSeed(seed as ActionSeed, [], heuristic);
    expect(draft.definition.urlContains).toBe("/checkout");
  });

  // Audit 00-14 M1+M2: mobile-born friction must never ride the web manifest.
  it("a mobile-only struggle type targets the mobile surface", async () => {
    const [seed] = proposeSeeds([
      row({ struggleType: "otp_failure_loop", path: "/Otp", score: 80 }),
    ]);
    const { draft } = await draftActionFromSeed(seed as ActionSeed, [], heuristic);
    expect(draft.definition.surface).toBe("mobile");
    expect(draft.definition.trigger.kind).toBe("struggle");
    expect(actionProposalDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("a shared struggle type whose dominant platform is an app targets mobile too", async () => {
    const [seed] = proposeSeeds([
      row({ struggleType: "form_abandon", path: "/Kyc", score: 45, platform: "android" }),
    ]);
    const { draft, evidence } = await draftActionFromSeed(seed as ActionSeed, [], heuristic);
    expect(evidence.platform).toBe("android");
    expect(draft.definition.surface).toBe("mobile");
  });

  it("web-dominant friction keeps the default surface (all)", async () => {
    const [seed] = proposeSeeds([row({ platform: "web" })]);
    const { draft } = await draftActionFromSeed(seed as ActionSeed, [], heuristic);
    expect(draft.definition.surface).toBeUndefined();
  });

  it("a matching FAQ grounds the seed: faq CTA + articleId evidence", async () => {
    const [seed] = proposeSeeds([row({ path: "/shipping", struggleType: "thrashing", score: 90 })]);
    const { draft, evidence } = await draftActionFromSeed(
      seed as ActionSeed,
      [
        {
          id: "a9",
          titleAr: "الشحن",
          bodyAr: "تفاصيل",
          titleEn: "Shipping info",
          bodyEn: "Details",
        },
      ],
      heuristic,
    );
    expect(evidence.articleId).toBe("a9");
    expect(draft.definition.content.ar.cta?.kind).toBe("faq");
  });
});

describe("draftActionFromSeed (semantic model)", () => {
  function modelWith(copy: Partial<ActionCopyDraft>, calls: DraftActionInput[] = []): LLMClient {
    return {
      name: "fake",
      ground: async () => ({ bestId: "", confidence: 0, grounded: false, reason: "" }),
      chat: async () => ({ reply: "", citationId: "", grounded: false, confidence: 0 }),
      draftAction: async (input) => {
        calls.push(input);
        return {
          name: "Checkout rescue",
          titleAr: "عنوان",
          bodyAr: "نص",
          ctaLabelAr: "زر",
          titleEn: "Title",
          bodyEn: "Body",
          ctaLabelEn: "Button",
          ...copy,
        };
      },
    };
  }

  it("uses the model's copy but keeps code-decided targeting/channel", async () => {
    const calls: DraftActionInput[] = [];
    const [seed] = proposeSeeds([row()]);
    const { draft } = await draftActionFromSeed(seed as ActionSeed, [], modelWith({}, calls));
    expect(draft.definition.content.en.title).toBe("Title");
    expect(draft.definition.content.en.cta?.kind).toBe("whatsapp"); // code, not model
    expect(calls[0]?.channel).toBe("whatsapp"); // the model is TOLD the channel
    expect(actionDefinitionSchema.safeParse(draft.definition).success).toBe(true);
  });

  it("falls back to the playbook when the model returns empty copy or throws", async () => {
    const [seed] = proposeSeeds([row()]);
    const empty = await draftActionFromSeed(
      seed as ActionSeed,
      [],
      modelWith({ titleAr: "", titleEn: "", bodyAr: "", bodyEn: "" }),
    );
    expect(empty.draft.definition.content.en.title).toBe("Having trouble here?");

    const throwing: LLMClient = {
      ...modelWith({}),
      draftAction: async () => {
        throw new Error("api down");
      },
    };
    const fb = await draftActionFromSeed(seed as ActionSeed, [], throwing);
    expect(fb.draft.definition.content.en.title).toBe("Having trouble here?");
    expect(actionDefinitionSchema.safeParse(fb.draft.definition).success).toBe(true);
  });
});
