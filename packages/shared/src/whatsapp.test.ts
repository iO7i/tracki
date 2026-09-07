import { describe, expect, it } from "vitest";
import { buildWhatsAppDeepLink, generateInquiryCode, parseInquiryCode } from "./whatsapp";

describe("inquiry code", () => {
  it("generates TR-XXXXXX with unambiguous chars", () => {
    const c = generateInquiryCode(() => 0.5);
    expect(c).toMatch(/^TR-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it("round-trips through parse (incl. embedded in a message)", () => {
    const code = generateInquiryCode(() => 0.1);
    expect(parseInquiryCode(`Hi, my inquiry number: ${code}`)).toBe(code);
    expect(parseInquiryCode(`مرحباً، رقم استفساري: ${code} شكراً`)).toBe(code);
  });

  it("returns null when no code present", () => {
    expect(parseInquiryCode("just a normal message")).toBeNull();
  });

  it("is case-insensitive on parse", () => {
    expect(parseInquiryCode("tr-abc234")).toBe("TR-ABC234");
  });
});

describe("buildWhatsAppDeepLink", () => {
  it("builds a wa.me link with prefilled code, digits only", () => {
    const link = buildWhatsAppDeepLink("+966 50 000 0000", "TR-ABC234", "en");
    expect(link).toContain("https://wa.me/966500000000?text=");
    expect(decodeURIComponent(link)).toContain("TR-ABC234");
  });

  it("prefills Arabic text for ar locale", () => {
    const link = buildWhatsAppDeepLink("966500000000", "TR-ABC234", "ar");
    expect(decodeURIComponent(link)).toContain("استفساري");
  });
});
