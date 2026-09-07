import type { StoredEvent } from "@tracki/shared";
import { describe, expect, it } from "vitest";
import { detectBatch } from "./detector.js";
import { InMemoryStateStore } from "./state.js";

let seq = 1_700_000_000_000;
function ev(partial: Partial<StoredEvent>): StoredEvent {
  // Detection windows on server time (received_at); mirror it to the provided
  // ts so tests drive timing through a single value.
  const t = partial.ts ?? seq++;
  return {
    org_id: "org",
    project_id: "proj",
    anon_id: "anon",
    user_id: "",
    session_id: "sess",
    event_id: `e${t}`,
    type: "pageview",
    path: "/checkout",
    url: "https://x.sa/checkout",
    referrer: "",
    props: "{}",
    ua: "Chrome/Windows",
    platform: "web",
    app_version: "",
    device_model: "",
    received_at: t,
    ...partial,
    ts: t,
  };
}

const clickProps = JSON.stringify({ tag: "button", id: "buy", class: "cta" });

describe("rage_click", () => {
  it("fires after 3 rapid clicks on the same element", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const clicks = [0, 500, 900].map((d) => ev({ type: "click", props: clickProps, ts: base + d }));
    const out = await detectBatch(store, clicks);
    const rage = out.filter((s) => s.type === "rage_click");
    expect(rage).toHaveLength(1);
    expect(rage[0]?.severity).toBe("medium");
  });

  it("does not fire for clicks spread beyond the window", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const clicks = [0, 4000, 8000].map((d) =>
      ev({ type: "click", props: clickProps, ts: base + d }),
    );
    const out = await detectBatch(store, clicks);
    expect(out.filter((s) => s.type === "rage_click")).toHaveLength(0);
  });

  it("debounces — one rage_click per burst, not per extra click", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const clicks = [0, 300, 600, 900, 1200].map((d) =>
      ev({ type: "click", props: clickProps, ts: base + d }),
    );
    const out = await detectBatch(store, clicks);
    expect(out.filter((s) => s.type === "rage_click")).toHaveLength(1);
  });
});

describe("dead_click (slice 11)", () => {
  const deadProps = JSON.stringify({ tag: "div", class: "fake-btn" });
  it("classifies a rapid cluster on a non-interactive element as dead_click, not rage", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const clicks = [0, 500, 900].map((d) => ev({ type: "click", props: deadProps, ts: base + d }));
    const out = await detectBatch(store, clicks);
    expect(out.filter((s) => s.type === "dead_click")).toHaveLength(1);
    expect(out.filter((s) => s.type === "rage_click")).toHaveLength(0);
    expect(out.find((s) => s.type === "dead_click")?.element).toBe("div||fake-btn");
  });
});

describe("repeated_submit (slice 11)", () => {
  it("fires on the 2nd submit of the same form within the window (high)", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const props = JSON.stringify({ tag: "form", id: "checkout" });
    const subs = [0, 3000].map((d) => ev({ type: "form_submit", props, ts: base + d }));
    const out = await detectBatch(store, subs);
    const rs = out.filter((s) => s.type === "repeated_submit");
    expect(rs).toHaveLength(1);
    expect(rs[0]?.severity).toBe("high");
    expect(rs[0]?.element).toBe("form|checkout|");
  });
});

describe("score + element (slice 11)", () => {
  it("rage carries an element signature and a 0–100 score with derived severity", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const clicks = [0, 400, 800].map((d) => ev({ type: "click", props: clickProps, ts: base + d }));
    const r = (await detectBatch(store, clicks)).find((s) => s.type === "rage_click");
    expect(r?.element).toBe("button|buy|cta");
    expect(r?.score).toBeGreaterThan(0);
    expect(r?.score).toBeLessThanOrEqual(100);
    expect(["low", "medium", "high"]).toContain(r?.severity);
  });
});

describe("repeated_error", () => {
  it("fires on the 2nd error in the window", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const out = await detectBatch(store, [
      ev({ type: "error", ts: base }),
      ev({ type: "error", ts: base + 1000 }),
    ]);
    expect(out.filter((s) => s.type === "repeated_error")).toHaveLength(1);
  });
});

describe("form_abandon severity", () => {
  it("is medium without a prior error", async () => {
    const store = new InMemoryStateStore();
    const out = await detectBatch(store, [ev({ type: "form_abandon" })]);
    const fa = out.find((s) => s.type === "form_abandon");
    expect(fa?.severity).toBe("medium");
  });

  it("escalates to high if the session errored first", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const out = await detectBatch(store, [
      ev({ type: "error", ts: base }),
      ev({ type: "form_abandon", ts: base + 2000 }),
    ]);
    const fa = out.find((s) => s.type === "form_abandon");
    expect(fa?.severity).toBe("high");
  });
});

describe("thrashing", () => {
  it("fires after 6 pageviews within 30s", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const pvs = Array.from({ length: 6 }, (_, i) => ev({ type: "pageview", ts: base + i * 1000 }));
    const out = await detectBatch(store, pvs);
    expect(out.filter((s) => s.type === "thrashing")).toHaveLength(1);
  });
});

describe("PII safety", () => {
  it("reason strings contain no event data, only rule text", async () => {
    const store = new InMemoryStateStore();
    const out = await detectBatch(store, [ev({ type: "form_abandon" })]);
    expect(out[0]?.reason).toMatch(/^[A-Za-z0-9 ]+$/);
  });
});

// ── Mobile rules (slice 14) ────────────────────────────────────────────────

const mob = { platform: "ios", app_version: "2.1.0" };

describe("otp_failure_loop", () => {
  it("fires on the 2nd OTP failure within 5min and carries device context", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const out = await detectBatch(store, [
      ev({ type: "otp_fail", path: "/otp", ...mob, ts: base }),
      ev({ type: "otp_fail", path: "/otp", ...mob, ts: base + 60_000 }),
    ]);
    const s = out.filter((x) => x.type === "otp_failure_loop");
    expect(s).toHaveLength(1);
    expect(s[0]?.severity).toBe("high"); // 75 base + 5 freq
    expect(s[0]?.element).toBe("otp");
    expect(s[0]?.platform).toBe("ios");
    expect(s[0]?.app_version).toBe("2.1.0");
  });

  it("does not fire for failures beyond the window", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const out = await detectBatch(store, [
      ev({ type: "otp_fail", ...mob, ts: base }),
      ev({ type: "otp_fail", ...mob, ts: base + 6 * 60_000 }),
    ]);
    expect(out.filter((x) => x.type === "otp_failure_loop")).toHaveLength(0);
  });
});

describe("biometric_failure_loop", () => {
  it("fires on the 2nd biometric failure", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const out = await detectBatch(store, [
      ev({ type: "biometric_fail", path: "/login", ...mob, ts: base }),
      ev({ type: "biometric_fail", path: "/login", ...mob, ts: base + 30_000 }),
    ]);
    expect(out.filter((x) => x.type === "biometric_failure_loop")).toHaveLength(1);
  });
});

describe("repeated_payment_failure", () => {
  it("fires on the 2nd payment failure and surfaces the method", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const props = JSON.stringify({ method: "visa" });
    const out = await detectBatch(store, [
      ev({ type: "payment_fail", path: "/payment", props, ...mob, ts: base }),
      ev({ type: "payment_fail", path: "/payment", props, ...mob, ts: base + 120_000 }),
    ]);
    const s = out.filter((x) => x.type === "repeated_payment_failure");
    expect(s).toHaveLength(1);
    expect(s[0]?.severity).toBe("high"); // 80 base + freq + path bonus
    expect(s[0]?.element).toBe("visa");
    expect(s[0]?.reason).toContain("visa");
  });
});

describe("app_restart_loop", () => {
  it("fires on the 3rd COLD start within 10min even across sessions", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const cold = JSON.stringify({ launch: "cold" });
    const out = await detectBatch(store, [
      ev({ type: "app_foreground", props: cold, session_id: "s1", ...mob, ts: base }),
      ev({ type: "app_foreground", props: cold, session_id: "s2", ...mob, ts: base + 120_000 }),
      ev({ type: "app_foreground", props: cold, session_id: "s3", ...mob, ts: base + 240_000 }),
    ]);
    expect(out.filter((x) => x.type === "app_restart_loop")).toHaveLength(1);
  });

  it("warm foregrounds never count", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const warm = JSON.stringify({ launch: "warm" });
    const out = await detectBatch(store, [
      ev({ type: "app_foreground", props: warm, ...mob, ts: base }),
      ev({ type: "app_foreground", props: warm, ...mob, ts: base + 1000 }),
      ev({ type: "app_foreground", props: warm, ...mob, ts: base + 2000 }),
    ]);
    expect(out.filter((x) => x.type === "app_restart_loop")).toHaveLength(0);
  });
});

describe("rapid_screen_switching", () => {
  it("fires after 6 screen views within 30s", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const views = Array.from({ length: 6 }, (_, i) =>
      ev({ type: "screen_view", path: `/screen${i}`, ...mob, ts: base + i * 1000 }),
    );
    const out = await detectBatch(store, views);
    expect(out.filter((x) => x.type === "rapid_screen_switching")).toHaveLength(1);
  });
});

describe("repeated_back_navigation", () => {
  it("fires after 4 back navigations within 30s", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const backs = Array.from({ length: 4 }, (_, i) =>
      ev({ type: "back_nav", ...mob, ts: base + i * 2000 }),
    );
    const out = await detectBatch(store, backs);
    expect(out.filter((x) => x.type === "repeated_back_navigation")).toHaveLength(1);
  });
});

describe("permission_denial_loop", () => {
  it("fires on the 2nd denial of the SAME permission", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const cam = JSON.stringify({ permission: "camera" });
    const out = await detectBatch(store, [
      ev({ type: "permission_denied", props: cam, ...mob, ts: base }),
      ev({ type: "permission_denied", props: cam, ...mob, ts: base + 60_000 }),
    ]);
    const s = out.filter((x) => x.type === "permission_denial_loop");
    expect(s).toHaveLength(1);
    expect(s[0]?.element).toBe("camera");
  });

  it("different permissions do not combine", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const out = await detectBatch(store, [
      ev({
        type: "permission_denied",
        props: JSON.stringify({ permission: "camera" }),
        ...mob,
        ts: base,
      }),
      ev({
        type: "permission_denied",
        props: JSON.stringify({ permission: "location" }),
        ...mob,
        ts: base + 1000,
      }),
    ]);
    expect(out.filter((x) => x.type === "permission_denial_loop")).toHaveLength(0);
  });
});

describe("deep_link_failure", () => {
  it("fires once (debounced) on a failed deep link; successes never fire", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const out = await detectBatch(store, [
      ev({ type: "deep_link", props: JSON.stringify({ ok: true }), ...mob, ts: base }),
      ev({ type: "deep_link", props: JSON.stringify({ ok: false }), ...mob, ts: base + 1000 }),
      ev({ type: "deep_link", props: JSON.stringify({ ok: false }), ...mob, ts: base + 2000 }),
    ]);
    expect(out.filter((x) => x.type === "deep_link_failure")).toHaveLength(1);
  });
});

describe("onboarding_abandonment", () => {
  it("fires for onboarding/registration flows only", async () => {
    const store = new InMemoryStateStore();
    const base = 1_700_000_000_000;
    const out = await detectBatch(store, [
      ev({
        type: "flow_abandon",
        props: JSON.stringify({ flow: "onboarding" }),
        session_id: "sA",
        ...mob,
        ts: base,
      }),
      ev({
        type: "flow_abandon",
        props: JSON.stringify({ flow: "checkout" }),
        session_id: "sB",
        ...mob,
        ts: base + 1000,
      }),
    ]);
    const s = out.filter((x) => x.type === "onboarding_abandonment");
    expect(s).toHaveLength(1);
    expect(s[0]?.element).toBe("onboarding");
  });
});
