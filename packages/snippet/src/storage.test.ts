import { beforeEach, describe, expect, it } from "vitest";
import { __reset, getAnonId, getSessionId, getUserId, setUserId } from "./storage";

beforeEach(() => __reset());

describe("anon id", () => {
  it("is stable across calls", () => {
    const a = getAnonId();
    expect(a).toMatch(/^anon_/);
    expect(getAnonId()).toBe(a);
  });
});

describe("user id", () => {
  it("is undefined until identified, then persists", () => {
    expect(getUserId()).toBeUndefined();
    setUserId("user_42");
    expect(getUserId()).toBe("user_42");
  });
});

describe("session id", () => {
  it("is stable within the timeout window", () => {
    const t = 1_000_000;
    const s = getSessionId(t);
    expect(s).toMatch(/^sess_/);
    expect(getSessionId(t + 60_000)).toBe(s);
  });

  it("rotates after 30 min of inactivity", () => {
    const t = 1_000_000;
    const s1 = getSessionId(t);
    const s2 = getSessionId(t + 31 * 60 * 1000);
    expect(s2).not.toBe(s1);
  });
});
