import { createHash } from "node:crypto";
import { SESSION_LIFETIME_MS, SESSION_RENEWAL_THRESHOLD_MS } from "./constants";

/**
 * Sessions are opaque tokens handed to the browser; only the SHA-256 hash is
 * stored server-side, so a DB leak does not leak usable sessions.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + SESSION_LIFETIME_MS);
}

export function isSessionExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** Sliding expiry: renew once less than half the lifetime remains. */
export function shouldRenewSession(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() - now.getTime() < SESSION_RENEWAL_THRESHOLD_MS;
}
