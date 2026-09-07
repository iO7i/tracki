import {
  type ActionDefinition,
  type ActionProposalDraft,
  type ActionProposalEvidence,
  type CtaKind,
  HIGH_INTENT_PATH,
  MOBILE_STRUGGLE_TYPES,
  STRUGGLE_TYPES,
  type StruggleType,
  normalizeText,
  proposalSeedKey,
} from "@tracki/shared";
import { type ActionCopyDraft, type LLMClient, getLLM } from "./llm";

/**
 * Tracki Autopilot (implementation) — the contextual campaign generation workflow:
 * read the friction report, draft targeted bilingual action PROPOSALS, and hand
 * them to a manager for review. Structure mirrors the VoC principle: the model
 * writes COPY only; seeds, ranking, targeting, trigger and channel are decided
 * deterministically in code from real data. Nothing here publishes anything.
 */

/** One friction-report row feeding Autopilot (path-level, implementation data). */
export interface StudioFrictionRow {
  path: string;
  struggleType: string;
  /** Struggle occurrences on this path in the window. */
  count: number;
  /** Summed 0–100 friction score for the path. */
  score: number;
  /** Dominant element signature, when element-bound. */
  element?: string;
  /** Dominant platform ('web' | 'ios' | 'android') — audit 00-14 M2. */
  platform?: string;
}

/** A recurring VoC gap question (implementation) that can reinforce/ground a seed. */
export interface StudioGap {
  question: string;
  count: number;
}

/** A published FAQ candidate for grounding a faq CTA. */
export interface StudioFaqCandidate {
  id: string;
  titleAr: string;
  bodyAr: string;
  titleEn: string;
  bodyEn: string;
  /** Normalized search text (write-side normalizeText), when available. */
  searchText?: string;
}

export interface ActionSeed {
  seedKey: string;
  evidence: ActionProposalEvidence;
}

/** Below this many occurrences a path is noise, not a campaign opportunity. */
export const MIN_SEED_COUNT = 2;
/** Friction score at (or above) which a high-intent path warrants WhatsApp. */
export const WHATSAPP_SCORE_FLOOR = 60;
/** How many proposals one generation run emits at most. */
export const MAX_SEEDS = 5;

const tokensOf = (s: string): Set<string> => new Set(normalizeText(s).split(" ").filter(Boolean));

/** Path → content tokens ("/ar/checkout/payment?x=1" → checkout, payment …). */
function pathTokens(path: string): Set<string> {
  return tokensOf(path.replace(/[/?&=#._-]+/g, " "));
}

/**
 * Rank friction rows into proposal seeds — pure and deterministic: filter noise,
 * sort by summed friction (then count, then path for total order), dedupe by
 * path|struggleType, attach a related VoC gap question when its tokens overlap
 * the path. No I/O.
 */
export function proposeSeeds(
  friction: StudioFrictionRow[],
  gaps: StudioGap[] = [],
  max = MAX_SEEDS,
): ActionSeed[] {
  const rows = friction
    .filter(
      (r) =>
        r.count >= MIN_SEED_COUNT &&
        r.path &&
        (STRUGGLE_TYPES as readonly string[]).includes(r.struggleType),
    )
    .sort((a, b) => b.score - a.score || b.count - a.count || a.path.localeCompare(b.path));

  const seen = new Set<string>();
  const seeds: ActionSeed[] = [];
  for (const r of rows) {
    const seedKey = proposalSeedKey(r.path, r.struggleType);
    if (seen.has(seedKey)) continue;
    seen.add(seedKey);
    const pTokens = pathTokens(r.path);
    const gap = gaps.find((g) => {
      for (const t of tokensOf(g.question)) if (pTokens.has(t)) return true;
      return false;
    });
    seeds.push({
      seedKey,
      evidence: {
        path: r.path,
        struggleType: r.struggleType,
        count: r.count,
        score: r.score,
        element: r.element || undefined,
        platform: r.platform || undefined,
        gapQuestion: gap?.question,
      },
    });
    if (seeds.length >= max) break;
  }
  return seeds;
}

/** Best-effort FAQ grounding: token overlap between the path (+ gap question)
 *  and the article's normalized text. Deterministic; returns undefined when
 *  nothing genuinely overlaps — never a forced match. */
export function matchFaqForSeed(
  seed: ActionSeed,
  candidates: StudioFaqCandidate[],
): StudioFaqCandidate | undefined {
  const ctx = new Set([
    ...pathTokens(seed.evidence.path),
    ...(seed.evidence.gapQuestion ? tokensOf(seed.evidence.gapQuestion) : []),
  ]);
  if (ctx.size === 0) return undefined;
  let best: { c: StudioFaqCandidate; hits: number } | undefined;
  for (const c of candidates) {
    const text = c.searchText ?? `${c.titleAr} ${c.bodyAr} ${c.titleEn} ${c.bodyEn}`;
    const cand = tokensOf(text);
    let hits = 0;
    for (const t of ctx) if (cand.has(t)) hits++;
    if (hits > 0 && (!best || hits > best.hits)) best = { c, hits };
  }
  return best?.c;
}

/**
 * Channel suggestion ("right channeling"): a grounding FAQ wins (self-service
 * first); otherwise a high-friction, high-intent path (checkout/payment) goes
 * straight to WhatsApp — the ME killer channel; everything else opens the
 * on-site Agent chat.
 */
export function suggestChannel(evidence: ActionProposalEvidence, hasFaqMatch: boolean): CtaKind {
  if (hasFaqMatch) return "faq";
  if (evidence.score >= WHATSAPP_SCORE_FLOOR && HIGH_INTENT_PATH.test(evidence.path)) {
    return "whatsapp";
  }
  return "chat";
}

// --- Deterministic GCC playbook templates (offline fallback + cold start) ---
// Real, publishable bilingual copy — NOT review stubs. A human gate still sits
// before `live` (proposal → manager review → draft action → manual toggle).

const CTA_LABELS: Record<Exclude<CtaKind, "url">, { ar: string; en: string }> = {
  whatsapp: { ar: "تواصل عبر واتساب", en: "Chat on WhatsApp" },
  chat: { ar: "تحدث معنا", en: "Chat with us" },
  faq: { ar: "اعرض الإجابة", en: "See the answer" },
};

const PLAYBOOK: Record<
  StruggleType,
  { ar: { title: string; body: string }; en: { title: string; body: string }; name: string }
> = {
  rage_click: {
    name: "Rescue: unresponsive page",
    ar: {
      title: "هل تواجه مشكلة هنا؟",
      body: "يبدو أن شيئًا لا يستجيب كما يجب. فريقنا جاهز لمساعدتك فورًا.",
    },
    en: {
      title: "Having trouble here?",
      body: "It looks like something isn't responding as it should. Our team is ready to help you right away.",
    },
  },
  dead_click: {
    name: "Rescue: confusing element",
    ar: {
      title: "هل تبحث عن شيء؟",
      body: "إذا لم تجد ما تتوقعه في هذه الصفحة، يسعدنا توجيهك مباشرة.",
    },
    en: {
      title: "Looking for something?",
      body: "If this page isn't doing what you expected, we're happy to point you in the right direction.",
    },
  },
  repeated_error: {
    name: "Rescue: repeated errors",
    ar: {
      title: "نعتذر عن هذا الخطأ",
      body: "نلاحظ أن خطأً تكرر معك. دعنا نساعدك في إتمام ما كنت تحاول فعله.",
    },
    en: {
      title: "Sorry about that error",
      body: "An error seems to be repeating. Let us help you finish what you were trying to do.",
    },
  },
  repeated_submit: {
    name: "Rescue: form not going through",
    ar: {
      title: "هل تواجه صعوبة في الإرسال؟",
      body: "إذا لم يكتمل النموذج من المحاولة الأولى، تواصل معنا وسنكمل الطلب معك خطوة بخطوة.",
    },
    en: {
      title: "Form not going through?",
      body: "If the form didn't go through on the first try, reach out and we'll complete it with you step by step.",
    },
  },
  form_abandon: {
    name: "Rescue: abandoned form",
    ar: {
      title: "نحن هنا إذا احتجت مساعدة",
      body: "لاحظنا أنك لم تُكمل النموذج. إذا كان هناك ما يصعّب الأمر، يسعدنا مساعدتك.",
    },
    en: {
      title: "We're here if you need help",
      body: "You didn't finish the form — if anything made it difficult, we'd be glad to help.",
    },
  },
  thrashing: {
    name: "Guide: hard-to-find info",
    ar: {
      title: "دعنا نوفر عليك الوقت",
      body: "إذا لم تجد ما تبحث عنه بسهولة، اسألنا مباشرة وسنرشدك فورًا.",
    },
    en: {
      title: "Let us save you some time",
      body: "If you can't easily find what you're looking for, just ask and we'll guide you right away.",
    },
  },
  // Mobile (implementation) — the same playbook discipline for in-app friction.
  repeated_payment_failure: {
    name: "Rescue: payment failing",
    ar: {
      title: "هل تواجه مشكلة في الدفع؟",
      body: "لم تكتمل عملية الدفع. جرّب وسيلة دفع أخرى مثل «مدى»، أو تواصل معنا وسنساعدك في إتمامها.",
    },
    en: {
      title: "Payment not going through?",
      body: "Your payment didn't complete. Try another method such as Mada, or reach out and we'll help you finish it.",
    },
  },
  otp_failure_loop: {
    name: "Rescue: OTP not arriving",
    ar: {
      title: "هل تحتاج مساعدة في استلام الرمز؟",
      body: "تأكد من رقم جوالك ثم اطلب رمزًا جديدًا. إذا استمرت المشكلة فنحن جاهزون لمساعدتك فورًا.",
    },
    en: {
      title: "Need help receiving your code?",
      body: "Check your mobile number and request a new code. If the problem continues, we're ready to help right away.",
    },
  },
  biometric_failure_loop: {
    name: "Rescue: biometric sign-in failing",
    ar: {
      title: "تعذّر التحقق بالبصمة؟",
      body: "يمكنك الدخول برمز التحقق بدلًا من البصمة، أو تواصل معنا وسنساعدك في الوصول لحسابك.",
    },
    en: {
      title: "Biometric check not working?",
      body: "You can sign in with a verification code instead, or contact us and we'll help you reach your account.",
    },
  },
  app_restart_loop: {
    name: "Rescue: app restarting",
    ar: {
      title: "نعتذر عن المشكلة التقنية",
      body: "لاحظنا إعادة تشغيل التطبيق أكثر من مرة. إذا كان شيء لا يعمل كما يجب، فريقنا جاهز لمساعدتك.",
    },
    en: {
      title: "Sorry about the technical trouble",
      body: "We noticed the app restarted several times. If something isn't working as it should, our team is ready to help.",
    },
  },
  deep_link_failure: {
    name: "Rescue: broken link",
    ar: {
      title: "لم يصلك الرابط إلى وجهته؟",
      body: "يبدو أن الرابط لم يفتح الصفحة الصحيحة. أخبرنا عمّا كنت تبحث عنه وسنوجهك مباشرة.",
    },
    en: {
      title: "That link didn't land right?",
      body: "It looks like the link didn't open the right screen. Tell us what you were after and we'll take you straight there.",
    },
  },
  onboarding_abandonment: {
    name: "Guide: finish signing up",
    ar: {
      title: "أنت على بُعد خطوة واحدة",
      body: "لم يكتمل تسجيلك بعد. إذا واجهتك أي صعوبة في الخطوات، يسعدنا مساعدتك في إكمالها.",
    },
    en: {
      title: "You're one step away",
      body: "Your registration isn't finished yet. If any step gave you trouble, we'd be glad to help you complete it.",
    },
  },
  permission_denial_loop: {
    name: "Guide: app permissions",
    ar: {
      title: "لماذا نطلب هذا الإذن؟",
      body: "بعض الميزات تحتاج إذنًا للعمل بشكل صحيح. اسألنا لمعرفة سبب الحاجة إليه وكيفية تفعيله.",
    },
    en: {
      title: "Why we ask for this permission",
      body: "Some features need a permission to work properly. Ask us what it's for and how to enable it.",
    },
  },
  repeated_back_navigation: {
    name: "Guide: lost in the app",
    ar: {
      title: "هل تبحث عن شاشة معينة؟",
      body: "لاحظنا تنقلًا متكررًا للخلف. أخبرنا بما تريد الوصول إليه وسنرشدك مباشرة.",
    },
    en: {
      title: "Looking for a specific screen?",
      body: "We noticed a lot of back-and-forth. Tell us where you're trying to go and we'll guide you straight there.",
    },
  },
  rapid_screen_switching: {
    name: "Guide: hard-to-find screen",
    ar: {
      title: "دعنا نوفر عليك الوقت",
      body: "إذا لم تجد ما تبحث عنه بين الشاشات، اسألنا مباشرة وسنرشدك فورًا.",
    },
    en: {
      title: "Let us save you some time",
      body: "If you can't find what you need across screens, just ask and we'll guide you right away.",
    },
  },
};

/** Checkout/payment paths get a purchase goal so Outcomes can count recovery. */
const GOAL_FOR_HIGH_INTENT = "purchase";

function heuristicCopy(evidence: ActionProposalEvidence, channel: CtaKind): ActionCopyDraft {
  const t = PLAYBOOK[evidence.struggleType as StruggleType] ?? PLAYBOOK.rage_click;
  const cta = CTA_LABELS[(channel === "url" ? "chat" : channel) as Exclude<CtaKind, "url">];
  return {
    name: `${t.name} — ${evidence.path}`.slice(0, 60),
    titleAr: t.ar.title,
    bodyAr: t.ar.body,
    ctaLabelAr: cta.ar,
    titleEn: t.en.title,
    bodyEn: t.en.body,
    ctaLabelEn: cta.en,
  };
}

function isEmptyCopy(d: ActionCopyDraft): boolean {
  return !(
    (d.titleAr || d.titleEn).trim() &&
    (d.bodyAr || d.bodyEn).trim() &&
    (d.ctaLabelAr || d.ctaLabelEn).trim()
  );
}

/**
 * Build the full ready-to-edit action from a seed: copy from the model (or the
 * playbook), everything else from the evidence. rage_click targets the instant
 * client trigger; all other struggle types are delivered server-side via Live
 * Assist (implementation). The definition always parses `actionDefinitionSchema`.
 */
export async function draftActionFromSeed(
  seed: ActionSeed,
  faqCandidates: StudioFaqCandidate[] = [],
  llm: LLMClient = getLLM(),
): Promise<{ draft: ActionProposalDraft; evidence: ActionProposalEvidence }> {
  const faqMatch = matchFaqForSeed(seed, faqCandidates);
  const evidence: ActionProposalEvidence = { ...seed.evidence, articleId: faqMatch?.id };
  const channel = suggestChannel(evidence, !!faqMatch);

  let copy = heuristicCopy(evidence, channel);
  if (llm.draftAction) {
    try {
      const snippets = [
        ...(faqMatch
          ? [
              `${faqMatch.titleEn || faqMatch.titleAr} — ${faqMatch.bodyEn || faqMatch.bodyAr}`.slice(
                0,
                300,
              ),
            ]
          : []),
        ...(evidence.gapQuestion ? [evidence.gapQuestion.slice(0, 200)] : []),
      ];
      const d = await llm.draftAction({
        path: evidence.path,
        struggleType: evidence.struggleType,
        count: evidence.count,
        score: evidence.score,
        element: evidence.element,
        channel: channel === "url" ? "chat" : channel,
        snippets,
      });
      if (!isEmptyCopy(d)) copy = d;
    } catch {
      /* model error → deterministic playbook copy */
    }
  }

  const isRage = evidence.struggleType === "rage_click";
  const highIntent = HIGH_INTENT_PATH.test(evidence.path);
  // urlContains is a substring filter — drop any query string so a seed from
  // "/checkout?step=2" still targets every /checkout visit.
  const urlContains = (evidence.path.split("?")[0] || evidence.path).slice(0, 400);
  const cta = { kind: channel } as { kind: CtaKind };
  // Audit 00-14 M1+M2: a proposal born from mobile-only friction (a mobile
  // struggle type, or a seed whose dominant platform is an app) must not ride
  // the web manifest — target the mobile surface explicitly.
  const mobileOnly =
    (MOBILE_STRUGGLE_TYPES as readonly string[]).includes(evidence.struggleType) ||
    evidence.platform === "ios" ||
    evidence.platform === "android";
  const definition: ActionDefinition = {
    type: "popup",
    content: {
      ar: { title: copy.titleAr, body: copy.bodyAr, cta: { label: copy.ctaLabelAr, ...cta } },
      en: { title: copy.titleEn, body: copy.bodyEn, cta: { label: copy.ctaLabelEn, ...cta } },
    },
    trigger: isRage ? { kind: "rage_click" } : { kind: "struggle" },
    ...(isRage ? {} : { struggleTypes: [evidence.struggleType as StruggleType] }),
    ...(mobileOnly ? { surface: "mobile" as const } : {}),
    urlContains,
    frequencyCap: 3,
    ...(highIntent ? { goalEvent: GOAL_FOR_HIGH_INTENT } : {}),
  };

  return { draft: { name: copy.name, definition }, evidence };
}
