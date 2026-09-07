import { beforeEach, describe, expect, it, vi } from "vitest";
import { installCapture } from "./capture";
import { EventQueue } from "./queue";
import { __reset } from "./storage";
import type { Batch } from "./types";

beforeEach(() => {
  __reset();
  document.body.innerHTML = "";
});

function makeQueue() {
  const sent: Batch[] = [];
  const q = new EventQueue("pk_test", "http://localhost/v1/events", (_e, b) => sent.push(b));
  return { q, sent };
}

/** Collect every event type seen across flushed batches + the live buffer. */
function typesFrom(sent: Batch[], q: EventQueue): string[] {
  q.flush(false);
  return sent.flatMap((b) => b.events.map((e) => e.type));
}

describe("auto-capture", () => {
  it("emits an initial pageview", () => {
    const { q, sent } = makeQueue();
    installCapture(q);
    expect(typesFrom(sent, q)).toContain("pageview");
  });

  it("emits form_focus then form_abandon on page hide without submit (Audit M3)", () => {
    document.body.innerHTML = `<form><input id="f" name="email" /></form>`;
    const { q, sent } = makeQueue();
    installCapture(q);

    document.getElementById("f")?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    const types = typesFrom(sent, q);
    expect(types).toContain("form_focus");
    expect(types).toContain("form_abandon");
  });

  it("does NOT emit form_abandon when the form was submitted", () => {
    document.body.innerHTML = `<form id="frm"><input id="f" /></form>`;
    const { q, sent } = makeQueue();
    installCapture(q);

    document.getElementById("f")?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    document.getElementById("frm")?.dispatchEvent(new Event("submit", { bubbles: true }));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    const types = typesFrom(sent, q);
    expect(types).toContain("form_submit");
    expect(types).not.toContain("form_abandon");
  });

  it("never captures password field interactions", () => {
    document.body.innerHTML = `<form><input id="pw" type="password" /></form>`;
    const { q, sent } = makeQueue();
    installCapture(q);
    document.getElementById("pw")?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(typesFrom(sent, q)).not.toContain("form_focus");
  });
});
