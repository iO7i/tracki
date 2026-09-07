import { randomBytes } from "node:crypto";

const PUBLIC_KEY_PREFIX = "pk_";
const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** URL-safe random string built from CSPRNG bytes. */
export function randomToken(length = 32): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index is within bytes length
    out += TOKEN_ALPHABET[bytes[i]! % TOKEN_ALPHABET.length];
  }
  return out;
}

/** Project public key embedded in customer sites: `pk_` + 24 random chars. */
export function generatePublicKey(): string {
  return `${PUBLIC_KEY_PREFIX}${randomToken(24)}`;
}

export function isPublicKey(value: string): boolean {
  return /^pk_[A-Za-z0-9]{24}$/.test(value);
}

/**
 * Slugify a display name. Arabic (and any non-latin) names produce an empty
 * base, in which case a random readable slug is generated instead — slugs stay
 * ASCII so they are stable in URLs, while display names stay localized.
 */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (base.length >= 3) return base;
  return `${base ? `${base}-` : ""}${randomToken(8).toLowerCase()}`;
}
