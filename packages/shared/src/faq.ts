import { z } from "zod";

export const FAQ_STATUSES = ["draft", "published"] as const;
export type FaqStatus = (typeof FAQ_STATUSES)[number];

export const FAQ_EVENT_TYPES = [
  "faq_view",
  "faq_search",
  "faq_search_noresult",
  "faq_vote_up",
  "faq_vote_down",
] as const;

const localized = z.object({
  title: z.string().trim().max(300),
  body: z.string().max(20_000),
});

export const createFaqSchema = z
  .object({
    category: z
      .string()
      .trim()
      .max(80)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    status: z.enum(FAQ_STATUSES),
    ar: localized,
    en: localized,
  })
  // At least one locale must have a title (so the article is findable).
  .refine((v) => v.ar.title.length > 0 || v.en.title.length > 0, "errors.required");
export type CreateFaqInput = z.infer<typeof createFaqSchema>;

/** A published article as served to the help center / widget (client-facing). */
export interface FaqArticleEntry {
  id: string;
  slug: string;
  category: string;
  tags: string[];
  ar: { title: string; body: string };
  en: { title: string; body: string };
}

/** Which locales an article has content for (CMS coverage flags). */
export function coverage(
  ar: { title: string },
  en: { title: string },
): {
  ar: boolean;
  en: boolean;
} {
  return { ar: ar.title.trim().length > 0, en: en.title.trim().length > 0 };
}
