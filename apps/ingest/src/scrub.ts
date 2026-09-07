import { containsPii, maskPii, scrubProperties, scrubText } from "@tracki/shared";

const MAX_DEPTH = 8;

/**
 * Recursively mask PII in any string within a JSON-serializable value.
 *
 * Audit B1: strings are masked at ANY depth (the type check runs before the
 * depth guard) — the depth guard bounds only container *traversal* and returns
 * a marker, never a raw subtree.
 * Audit B2: object keys are masked too (PII is commonly used as map keys).
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth === 0) return scrubProperties(value);
  if (typeof value === "string") return maskPii(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[maskPii(k)] = scrubValue(v, depth + 1);
  }
  return out;
}

export function scrubString(value: string | undefined): string {
  return value ? scrubText(value) : "";
}

/**
 * Audit N1: defense-in-depth backstop. Masks PII over an already-serialized
 * string (catches anything structural scrubbing missed). Idempotent. In dev it
 * also surfaces residual PII loudly so regressions can't ship silently.
 */
export function scrubSerialized(text: string): string {
  const masked = maskPii(text);
  if (process.env.NODE_ENV !== "production" && containsPii(masked)) {
    console.warn("scrubSerialized: residual PII after masking — check scrub coverage");
  }
  return masked;
}
