/**
 * Single source of truth for rage-click detection, shared by the server-side
 * struggle detector (analytics) and the snippet's client-side detector
 * (instant intervention). Zero deps so the snippet can import it via the
 * `@tracki/shared/rage` subpath without pulling node:crypto.
 *
 * (Audit 00-04 S3: the two detectors previously hard-coded the same constants
 * and signature format independently and could drift.)
 */

export const RAGE_WINDOW_MS = 3000;
export const RAGE_MIN_CLICKS = 3;

// Bound each signature part and the whole, so a hostile client can't write a
// multi-KB element string (props is byte-capped server-side, but the signature
// itself was previously uncapped) and can't smuggle control/bidi chars that
// bloat or visually spoof the dashboard table. (Slice-11 hardening F1/F2.)
const MAX_TAG = 32;
const MAX_PART = 96;

/** True for C0/C1 controls + DEL, zero-width & bidi marks, embeds/overrides, isolates. */
function isUnsafeChar(c: number): boolean {
  return (
    c <= 0x1f ||
    (c >= 0x7f && c <= 0x9f) ||
    (c >= 0x200b && c <= 0x200f) ||
    (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2066 && c <= 0x2069)
  );
}

function sanitize(s: string, max: number): string {
  let out = "";
  for (const ch of s) {
    if (out.length >= max) break;
    const c = ch.codePointAt(0) ?? 0;
    if (!isUnsafeChar(c)) out += ch;
  }
  return out;
}

/**
 * Bound + clean a free-form mobile signal label (flow name, permission,
 * payment method…) before it lands in a struggle row's `element` column —
 * same sanitization chokepoint as elementSignature (slice-11 F1/F2).
 */
export function boundLabel(s: string): string {
  return sanitize(s, MAX_PART);
}

/** Stable element signature: tag|id|class. Tag is lowercased. Bounded + cleaned. */
export function elementSignature(el: {
  tag?: string | null;
  id?: string | null;
  class?: string | null;
}): string {
  const tag = sanitize((el.tag ?? "").toLowerCase(), MAX_TAG);
  const id = sanitize(el.id ?? "", MAX_PART);
  const cls = sanitize(el.class ?? "", MAX_PART);
  return `${tag}|${id}|${cls}`;
}
