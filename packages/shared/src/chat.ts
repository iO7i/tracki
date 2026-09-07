import { z } from "zod";

/** Max user turns in one conversation before the Agent force-escalates. */
export const MAX_TURNS = 12;

export const CHAT_RESOLUTIONS = ["open", "self_resolved", "escalated", "abandoned"] as const;
export type ChatResolution = (typeof CHAT_RESOLUTIONS)[number];

export const CHAT_ROLES = ["user", "assistant"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export const chatRequestSchema = z.object({
  key: z.string().min(3).max(64),
  anonId: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(64),
  userId: z.string().min(1).max(128).optional(),
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(2000),
  path: z.string().max(2048).optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface ChatReply {
  conversationId: string;
  reply: string;
  citation?: { articleId: string; title: string };
  escalate: boolean;
}

/**
 * Default blocked-topics / prompt-injection screen (v1, project-config later).
 * A hit forces refuse + escalate before any LLM/retrieval runs.
 */
export const BLOCKED_PATTERNS: RegExp[] = [
  /ignore (all |your )?(previous |prior )?instructions/i,
  /disregard (the )?(system|above)/i,
  /you are now|act as (an? )?(dan|jailbreak)/i,
  /system prompt/i,
];

export function isBlocked(message: string): boolean {
  return BLOCKED_PATTERNS.some((re) => re.test(message));
}
