/**
 * Server actions return an i18n error key (e.g. "errors.invalidEmail") —
 * never raw user-facing text. Forms translate the key client-side.
 */
export type ActionState = { error: string } | undefined;

/** Reject open redirects: only same-origin absolute paths are honored. */
export function safeNextPath(next: unknown): string | null {
  if (typeof next !== "string") return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}
