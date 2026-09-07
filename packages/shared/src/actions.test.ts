import { describe, expect, it } from "vitest";
import {
  actionDefinitionSchema,
  actionProposalDraftSchema,
  createActionSchema,
  isInSchedule,
  mobileCoverageTargets,
  pickVariant,
  proposalSeedKey,
  resolveCtaKind,
  surfaceMatches,
} from "./actions";

const validDef = {
  type: "popup" as const,
  content: {
    ar: {
      title: "مساعدة",
      body: "هل تحتاج مساعدة؟",
      cta: { label: "نعم", url: "https://help.sa/faq" },
    },
    en: { title: "Help", body: "Need help?", cta: { label: "Yes", url: "https://help.sa/faq" } },
  },
  trigger: { kind: "rage_click" as const },
  urlContains: "/checkout",
};

describe("actionDefinitionSchema", () => {
  it("accepts a valid popup", () => {
    expect(actionDefinitionSchema.safeParse(validDef).success).toBe(true);
  });

  it("rejects a non-http CTA url (XSS guard)", () => {
    const bad = {
      ...validDef,
      content: {
        ...validDef.content,
        en: { ...validDef.content.en, cta: { label: "x", url: "javascript:alert(1)" } },
      },
    };
    expect(actionDefinitionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown action types", () => {
    expect(actionDefinitionSchema.safeParse({ ...validDef, type: "lightbox" }).success).toBe(false);
  });

  // Slice 12 — channel CTAs.
  const withCta = (cta: object) => ({
    ...validDef,
    content: { ...validDef.content, en: { ...validDef.content.en, cta } },
  });

  it("accepts widget-channel CTAs without a url (chat / whatsapp / faq)", () => {
    for (const kind of ["chat", "whatsapp", "faq"]) {
      expect(actionDefinitionSchema.safeParse(withCta({ label: "x", kind })).success).toBe(true);
    }
  });

  it("still requires a url for a url-kind CTA", () => {
    expect(actionDefinitionSchema.safeParse(withCta({ label: "x", kind: "url" })).success).toBe(
      false,
    );
    expect(actionDefinitionSchema.safeParse(withCta({ label: "x" })).success).toBe(false);
  });

  it("keeps parsing pre-slice-12 definitions (faq:true, url-only)", () => {
    expect(actionDefinitionSchema.safeParse(withCta({ label: "x", faq: true })).success).toBe(true);
    expect(
      actionDefinitionSchema.safeParse(withCta({ label: "x", url: "https://a.sa/h" })).success,
    ).toBe(true);
  });

  it("rejects unknown CTA kinds", () => {
    expect(actionDefinitionSchema.safeParse(withCta({ label: "x", kind: "sms" })).success).toBe(
      false,
    );
  });

  // Slice 14 — surfaces + mobile-only types.
  const step = { ar: { title: "خطوة", body: "وصف" }, en: { title: "Step", body: "Desc" } };

  it("accepts surface targeting and defaults to all", () => {
    expect(actionDefinitionSchema.safeParse({ ...validDef, surface: "mobile" }).success).toBe(true);
    expect(surfaceMatches({}, "web")).toBe(true); // absent surface ⇒ all
    expect(surfaceMatches({}, "mobile")).toBe(true);
    expect(surfaceMatches({ surface: "mobile" }, "web")).toBe(false);
    expect(surfaceMatches({ surface: "web" }, "mobile")).toBe(false);
  });

  it("tour/drawer are mobile-only (web snippet has no renderer)", () => {
    expect(
      actionDefinitionSchema.safeParse({ ...validDef, type: "drawer", surface: "mobile" }).success,
    ).toBe(true);
    for (const surface of [undefined, "all", "web"] as const) {
      expect(
        actionDefinitionSchema.safeParse({ ...validDef, type: "drawer", surface }).success,
        `drawer on ${surface}`,
      ).toBe(false);
    }
  });

  it("a tour requires steps; steps are bounded", () => {
    const tour = { ...validDef, type: "tour" as const, surface: "mobile" as const };
    expect(actionDefinitionSchema.safeParse(tour).success).toBe(false);
    expect(actionDefinitionSchema.safeParse({ ...tour, steps: [step] }).success).toBe(true);
    expect(
      actionDefinitionSchema.safeParse({ ...tour, steps: Array.from({ length: 11 }, () => step) })
        .success,
    ).toBe(false);
  });

  // Audit-14 M1+M3 regression: coverage must reflect what can actually
  // intervene on mobile, never web-only presence.
  it("mobileCoverageTargets: a live WEB action never covers mobile screens", () => {
    expect(mobileCoverageTargets([{ surface: "web", trigger: { kind: "pageview" } }])).toEqual([]);
    expect(
      mobileCoverageTargets([
        { surface: "web", urlContains: "Checkout", trigger: { kind: "struggle" } },
      ]),
    ).toEqual([]);
  });

  it("mobileCoverageTargets: only struggle-trigger actions blanket-cover", () => {
    // Presence (pageview everywhere) is not intervention — no blanket coverage.
    expect(mobileCoverageTargets([{ surface: "all", trigger: { kind: "pageview" } }])).toEqual([]);
    expect(mobileCoverageTargets([{ surface: "mobile", trigger: { kind: "struggle" } }])).toEqual([
      "*",
    ]);
    // Screen-targeted mobile actions cover their screens.
    expect(
      mobileCoverageTargets([
        { surface: "mobile", urlContains: "Checkout", trigger: { kind: "pageview" } },
        { surface: "all", urlContains: "Otp", trigger: { kind: "event" } },
      ]),
    ).toEqual(["Checkout", "Otp"]);
  });

  it("accepts mobile struggle types in Live Assist targeting (cap 15)", () => {
    const assist = {
      ...validDef,
      trigger: { kind: "struggle" as const },
      struggleTypes: ["otp_failure_loop", "repeated_payment_failure", "rage_click"],
    };
    expect(actionDefinitionSchema.safeParse(assist).success).toBe(true);
  });
});

describe("resolveCtaKind", () => {
  it("prefers the explicit kind", () => {
    expect(resolveCtaKind({ kind: "whatsapp" })).toBe("whatsapp");
    expect(resolveCtaKind({ kind: "chat", faq: true })).toBe("chat");
  });
  it("maps legacy shapes (faq boolean, url-only) correctly", () => {
    expect(resolveCtaKind({ faq: true })).toBe("faq");
    expect(resolveCtaKind({ url: "https://a.sa" })).toBe("url");
  });
});

describe("action proposals (slice 12)", () => {
  it("a proposal draft is a full, valid action", () => {
    const r = actionProposalDraftSchema.safeParse({
      name: "Checkout rescue",
      definition: validDef,
    });
    expect(r.success).toBe(true);
    expect(actionProposalDraftSchema.safeParse({ name: "x", definition: validDef }).success).toBe(
      false,
    );
  });
  it("seed key is stable per path+type", () => {
    expect(proposalSeedKey("/checkout", "rage_click")).toBe("/checkout|rage_click");
  });
});

describe("createActionSchema", () => {
  it("surfaces an i18n key for a short name", () => {
    const r = createActionSchema.safeParse({ name: "x", status: "draft", definition: validDef });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("errors.nameTooShort");
  });
});

describe("pickVariant", () => {
  it("returns A when there is no B variant", () => {
    expect(pickVariant("anon_1", "act_1", false)).toBe("A");
  });

  it("is stable for the same visitor+action", () => {
    const a = pickVariant("anon_42", "act_9", true);
    expect(pickVariant("anon_42", "act_9", true)).toBe(a);
  });

  it("splits a population roughly 50/50", () => {
    let a = 0;
    for (let i = 0; i < 1000; i++) if (pickVariant(`anon_${i}`, "act_x", true) === "A") a++;
    expect(a).toBeGreaterThan(380);
    expect(a).toBeLessThan(620);
  });
});

describe("isInSchedule", () => {
  const now = Date.parse("2026-06-04T12:00:00Z");
  it("is true with no schedule", () => {
    expect(isInSchedule(undefined, now)).toBe(true);
  });
  it("respects start and end bounds", () => {
    expect(isInSchedule({ start: "2026-06-05T00:00:00Z" }, now)).toBe(false);
    expect(isInSchedule({ end: "2026-06-03T00:00:00Z" }, now)).toBe(false);
    expect(isInSchedule({ start: "2026-06-01T00:00:00Z", end: "2026-06-30T00:00:00Z" }, now)).toBe(
      true,
    );
  });
});
