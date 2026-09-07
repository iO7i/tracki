import { describe, expect, it } from "vitest";
import { generatePublicKey, isPublicKey, randomToken, slugify } from "./ids";

describe("randomToken", () => {
  it("generates the requested length from the safe alphabet", () => {
    const t = randomToken(32);
    expect(t).toHaveLength(32);
    expect(t).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("does not collide across many generations", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => randomToken(24)));
    expect(seen.size).toBe(1000);
  });
});

describe("generatePublicKey", () => {
  it("produces validatable pk_ keys", () => {
    const key = generatePublicKey();
    expect(isPublicKey(key)).toBe(true);
    expect(isPublicKey("pk_short")).toBe(false);
    expect(isPublicKey("sk_aaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });
});

describe("slugify", () => {
  it("slugifies latin names", () => {
    expect(slugify("Riyadh Bank — Main Site")).toBe("riyadh-bank-main-site");
  });

  it("strips diacritics", () => {
    expect(slugify("Café Société")).toBe("cafe-societe");
  });

  it("generates a random ascii slug for Arabic names", () => {
    const slug = slugify("بنك الرياض التجريبي");
    expect(slug).toMatch(/^[a-z0-9-]{3,}$/);
  });

  it("never returns slugs shorter than 3 chars", () => {
    expect(slugify("ab").length).toBeGreaterThanOrEqual(3);
    expect(slugify("").length).toBeGreaterThanOrEqual(3);
  });
});
