import { describe, expect, it } from "vitest";
import { SESSION_LIFETIME_MS } from "./constants";
import {
  hashSessionToken,
  isSessionExpired,
  sessionExpiryFrom,
  shouldRenewSession,
} from "./session";

describe("hashSessionToken", () => {
  it("is deterministic and not the identity", () => {
    const token = "abc123";
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toBe(token);
    expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("session expiry", () => {
  const now = new Date("2026-06-04T12:00:00Z");

  it("expires exactly one lifetime after issuance", () => {
    const expiry = sessionExpiryFrom(now);
    expect(expiry.getTime() - now.getTime()).toBe(SESSION_LIFETIME_MS);
  });

  it("detects expired sessions", () => {
    expect(isSessionExpired(new Date(now.getTime() - 1), now)).toBe(true);
    expect(isSessionExpired(new Date(now.getTime() + 1000), now)).toBe(false);
  });

  it("renews only when less than half the lifetime remains", () => {
    const fresh = sessionExpiryFrom(now);
    expect(shouldRenewSession(fresh, now)).toBe(false);
    const halfway = new Date(now.getTime() + SESSION_LIFETIME_MS / 2 - 1000);
    expect(shouldRenewSession(halfway, now)).toBe(true);
  });
});
