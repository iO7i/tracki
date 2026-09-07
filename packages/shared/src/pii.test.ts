import { describe, expect, it } from "vitest";
import { containsPii, maskEmail, maskPan, maskPhone, maskPii, maskToken } from "./pii";

describe("maskEmail", () => {
  it("masks the local part but keeps the domain", () => {
    expect(maskEmail("contact me at fatima.alsaud@example.com please")).toBe(
      "contact me at fa***@example.com please",
    );
  });

  it("masks multiple emails", () => {
    const out = maskEmail("a.b@x.com and someone@y.org");
    expect(out).not.toContain("a.b@x.com");
    expect(out).not.toContain("someone@y.org");
    expect(out).toContain("***@x.com");
    expect(out).toContain("***@y.org");
  });
});

describe("maskPhone", () => {
  it.each([
    "+966501234567",
    "+966 50 123 4567",
    "00971501234567",
    "+97336001234",
    "+97455501234",
    "+96550012345",
    "+96891234567",
    "+201001234567",
  ])("masks international ME number %s", (phone) => {
    const out = maskPhone(`call ${phone} now`);
    expect(out).not.toContain(phone);
    expect(out).toMatch(/\*{3,}/);
  });

  it("masks local Saudi/Egypt mobile formats", () => {
    expect(maskPhone("0501234567")).not.toContain("0501234567");
    expect(maskPhone("01001234567")).not.toContain("01001234567");
  });

  it("keeps the last two digits for operator reference", () => {
    expect(maskPhone("+966501234567")).toMatch(/67$/);
  });

  it("does not mangle plain numbers in normal text", () => {
    expect(maskPhone("order 12345 costs 200 SAR")).toBe("order 12345 costs 200 SAR");
  });
});

describe("maskPii / containsPii", () => {
  it("masks mixed PII in Arabic text", () => {
    const input = "تواصلوا معي على ahmad@test.sa أو +966512345678 شكراً";
    const out = maskPii(input);
    expect(out).not.toContain("ahmad@test.sa");
    expect(out).not.toContain("+966512345678");
    expect(out).toContain("شكراً");
  });

  it("containsPii detects raw PII and clears after masking", () => {
    const input = "email: x.y@z.io phone: +971501234567";
    expect(containsPii(input)).toBe(true);
    expect(containsPii(maskPii(input))).toBe(false);
    expect(containsPii("لا توجد بيانات شخصية هنا")).toBe(false);
  });

  it("is idempotent — masking already-masked text changes nothing", () => {
    const input =
      "x.y@z.io +971501234567 card 4111111111111111 key deadbeefdeadbeefdeadbeefdeadbeef";
    const once = maskPii(input);
    expect(maskPii(once)).toBe(once);
    expect(containsPii(once)).toBe(false);
  });
});

describe("maskPan (implementation hardening)", () => {
  it("masks a Luhn-valid PAN, keeping the last 4", () => {
    const out = maskPan("pay with 4111111111111111 now");
    expect(out).not.toContain("4111111111111111");
    expect(out).toContain("1111"); // last 4 kept
    expect(out).toMatch(/\*{12}1111/);
  });

  it("masks grouped card numbers (spaces/dashes)", () => {
    expect(maskPan("4111 1111 1111 1111")).not.toContain("4111 1111 1111 1111");
    expect(maskPan("4111-1111-1111-1111")).not.toContain("4111-1111-1111-1111");
  });

  it("leaves non-Luhn digit runs and short numbers alone", () => {
    expect(maskPan("order 1234567890123456 ref")).toBe("order 1234567890123456 ref"); // fails Luhn
    expect(maskPan("invoice 12345678 total")).toBe("invoice 12345678 total"); // too short
  });
});

describe("maskToken (implementation hardening)", () => {
  it("masks a JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0";
    const out = maskToken(`bearer ${jwt}`);
    expect(out).not.toContain(jwt);
    expect(out).toContain("eyJhbG***");
  });

  it("masks a long hex key/hash but not a UUID", () => {
    expect(maskToken("key deadbeefdeadbeefdeadbeefdeadbeef end")).toMatch(/\*{28}beef/);
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(maskToken(`id ${uuid}`)).toContain(uuid); // dashed segments < 32, left intact
  });
});
