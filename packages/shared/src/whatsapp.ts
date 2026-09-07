import { z } from "zod";

export const WA_DIRECTIONS = ["inbound", "outbound"] as const;
export type WaDirection = (typeof WA_DIRECTIONS)[number];

export const WA_AUTHORS = ["customer", "agent", "operator"] as const;
export type WaAuthor = (typeof WA_AUTHORS)[number];

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

/** Human-typable inquiry code: TR-XXXXXX. */
export function generateInquiryCode(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return `TR-${s}`;
}

const CODE_RE = /TR-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}/;

/** Extract an inquiry code from an inbound message (or null). */
export function parseInquiryCode(text: string): string | null {
  const m = text.toUpperCase().match(CODE_RE);
  return m ? m[0] : null;
}

/** Build the wa.me deep link with a prefilled message carrying the code. */
export function buildWhatsAppDeepLink(
  businessNumber: string,
  code: string,
  locale: "ar" | "en",
): string {
  const num = businessNumber.replace(/[^0-9]/g, "");
  const text = locale === "ar" ? `مرحباً، رقم استفساري: ${code}` : `Hi, my inquiry number: ${code}`;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

export const handoffRequestSchema = z.object({
  key: z.string().min(3).max(64),
  anonId: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(64),
  conversationId: z.string().uuid().optional(),
  path: z.string().max(2048).optional(),
  locale: z.enum(["ar", "en"]).optional(),
  // Audit 00-14 N2: mobile SDKs say where the customer is stuck; absent ⇒ web.
  platform: z.enum(["web", "ios", "android"]).optional(),
});
export type HandoffRequest = z.infer<typeof handoffRequestSchema>;

export interface HandoffContext {
  path?: string;
  struggle?: string;
  agentSummary?: string;
  /** 'web' | 'ios' | 'android' — lets the inbox label the surface (00-14 N2). */
  platform?: string;
}
