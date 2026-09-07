import { describe, expect, it } from "vitest";
import { RAGE_MIN_CLICKS, RAGE_WINDOW_MS, elementSignature } from "./rage";

describe("rage constants", () => {
  it("are shared, sane values", () => {
    expect(RAGE_MIN_CLICKS).toBe(3);
    expect(RAGE_WINDOW_MS).toBe(3000);
  });
});

describe("elementSignature", () => {
  it("lowercases the tag and joins tag|id|class", () => {
    expect(elementSignature({ tag: "BUTTON", id: "buy", class: "cta" })).toBe("button|buy|cta");
  });

  it("is identical for the server (props) and client (element) shapes", () => {
    // server: parsed from props JSON; client: from a DOM element
    const fromProps = elementSignature({ tag: "button", id: "buy", class: "cta" });
    const fromEl = elementSignature({ tag: "BUTTON", id: "buy", class: "cta" });
    expect(fromProps).toBe(fromEl);
  });

  it("tolerates missing/null fields", () => {
    expect(elementSignature({})).toBe("|" + "|");
    expect(elementSignature({ tag: null, id: null, class: null })).toBe("||");
  });

  it("bounds each part so a hostile client can't write a multi-KB signature (F1)", () => {
    const sig = elementSignature({
      tag: "div".repeat(50),
      id: "x".repeat(500),
      class: "y".repeat(500),
    });
    const [tag, id, cls] = sig.split("|");
    expect(tag?.length).toBe(32);
    expect(id?.length).toBe(96);
    expect(cls?.length).toBe(96);
  });

  it("strips control and bidi-override characters (F2)", () => {
    // NUL, RTL-override (U+202E), zero-width space (U+200B) — never literal in source.
    const evil = `bu${String.fromCharCode(0x202e)}y${String.fromCharCode(0x200b)}${String.fromCharCode(0)}`;
    expect(elementSignature({ tag: "button", id: evil, class: "" })).toBe("button|buy|");
  });
});
