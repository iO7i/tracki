/**
 * PII masking utilities — cross-cutting rule: PII never reaches analytics
 * storage or logs unmasked. implementation ships email + phone masking (incl. the
 * Gulf/Egypt formats Tracki targets); implementation hardening adds payment-card
 * (Luhn-validated PAN) and secret-token (JWT / long hex) masking, since the
 * rich struggle `element` signature now surfaces DOM id/class values
 * prominently in the dashboard. NER-based name masking remains deferred.
 */

const EMAIL_RE = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/**
 * Phone numbers, tolerant of separators, anchored to ME country codes or
 * local formats: KSA +966, UAE +971, Bahrain +973, Qatar +974, Kuwait +965,
 * Oman +968, Egypt +20, plus generic 05xxxxxxxx / 01xxxxxxxxx local mobiles.
 */
const PHONE_RE =
  /(?:\+|00)(?:966|971|973|974|965|968|20)[\s-]?(?:\d[\s-]?){7,10}\d|\b0(?:5\d{8}|1\d{9})\b/g;

/** Candidate payment-card numbers: 13–19 digits, optionally space/dash grouped. */
const PAN_RE = /\b(?:\d[ -]?){12,18}\d\b/g;
/** JSON Web Tokens — anchored on the `eyJ` (base64 of `{"`) header prefix. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
/** Long hex blobs — API keys, hashes, session secrets (MD5/SHA and up). */
const HEX_TOKEN_RE = /\b[0-9a-fA-F]{32,}\b/g;

/** Luhn check — only mask digit runs that actually validate as a card. */
function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function maskEmail(email: string): string {
  return email.replace(EMAIL_RE, (_m, user: string, domain: string) => {
    const head = user.slice(0, 2);
    return `${head}***@${domain}`;
  });
}

export function maskPhone(text: string): string {
  return text.replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    return `${m.slice(0, m.startsWith("+") ? 4 : 2)}${"*".repeat(Math.max(digits.length - 6, 3))}${digits.slice(-2)}`;
  });
}

/** Mask Luhn-valid payment-card numbers, keeping only the last 4 digits. */
export function maskPan(text: string): string {
  return text.replace(PAN_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || !isLuhnValid(digits)) return m;
    return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
  });
}

/** Mask secret tokens (JWTs and long hex keys/hashes). */
export function maskToken(text: string): string {
  return text
    .replace(JWT_RE, (m) => `${m.slice(0, 6)}***`)
    .replace(HEX_TOKEN_RE, (m) => `${"*".repeat(m.length - 4)}${m.slice(-4)}`);
}

/** Mask all supported PII classes inside arbitrary text. Order matters: tokens
 *  before PAN (a hex key may contain a Luhn-valid digit run), PAN before phone. */
export function maskPii(text: string): string {
  return maskPhone(maskPan(maskToken(maskEmail(text))));
}

/** True when the text still contains detectable raw PII (used by guards/tests). */
export function containsPii(text: string): boolean {
  // Fresh RegExp instances: the module-level ones are stateful (global flag).
  if (new RegExp(EMAIL_RE.source).test(text)) return true;
  if (new RegExp(PHONE_RE.source).test(text)) return true;
  if (new RegExp(JWT_RE.source).test(text)) return true;
  if (new RegExp(HEX_TOKEN_RE.source).test(text)) return true;
  // PAN only counts if a candidate run actually validates as a card.
  const pans = text.match(new RegExp(PAN_RE.source, "g"));
  return pans?.some((m) => isLuhnValid(m.replace(/\D/g, ""))) ?? false;
}
