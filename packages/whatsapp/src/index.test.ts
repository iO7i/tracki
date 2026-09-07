import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MetaCloudProvider,
  SimulatorProvider,
  __setProvider,
  assertConfig,
  getProvider,
  isSimulator,
  simulateAllowed,
  verifySignature,
} from "./index";

// vi.stubEnv mutates process.env for the test and unstubAllEnvs restores it —
// real removal (passing undefined), without the delete operator (biome noDelete).
afterEach(() => {
  __setProvider(null);
  vi.unstubAllEnvs();
});

describe("provider selection", () => {
  it("defaults to the simulator", () => {
    __setProvider(null);
    expect(getProvider().name).toBe("simulator");
    expect(isSimulator()).toBe(true);
  });

  it("SimulatorProvider records sends", async () => {
    const p = new SimulatorProvider();
    await p.sendText("966500000000", "hi");
    expect(p.sent).toEqual([{ to: "966500000000", text: "hi" }]);
  });

  it("MetaCloudProvider is constructible (not exercised offline)", () => {
    expect(new MetaCloudProvider("tok", "pid").name).toBe("meta");
  });
});

describe("verifySignature", () => {
  it("accepts when no secret configured in dev/simulator mode", () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", undefined);
    vi.stubEnv("WHATSAPP_PROVIDER", undefined);
    expect(verifySignature("{}", undefined)).toBe(true);
  });

  it("fails closed when no secret but provider is meta (Audit B1)", () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", undefined);
    vi.stubEnv("WHATSAPP_PROVIDER", "meta");
    expect(verifySignature("{}", undefined)).toBe(false);
    expect(verifySignature("{}", "sha256=deadbeef")).toBe(false);
  });

  it("validates a correct HMAC and rejects a bad one", () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "s3cr3t");
    const body = '{"a":1}';
    const good = `sha256=${createHmac("sha256", "s3cr3t").update(body).digest("hex")}`;
    expect(verifySignature(body, good)).toBe(true);
    expect(verifySignature(body, "sha256=deadbeef")).toBe(false);
    expect(verifySignature(body, undefined)).toBe(false);
  });
});

describe("assertConfig (Audit B1/B2 boot check)", () => {
  it("is a no-op outside meta mode", () => {
    vi.stubEnv("WHATSAPP_PROVIDER", undefined);
    expect(() => assertConfig()).not.toThrow();
  });

  it("throws when meta mode is missing any credential", () => {
    vi.stubEnv("WHATSAPP_PROVIDER", "meta");
    vi.stubEnv("WHATSAPP_TOKEN", undefined);
    expect(() => assertConfig()).toThrow(/required when WHATSAPP_PROVIDER=meta/);
  });

  it("passes when meta mode is fully configured", () => {
    vi.stubEnv("WHATSAPP_PROVIDER", "meta");
    vi.stubEnv("WHATSAPP_TOKEN", "tok");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "pid");
    vi.stubEnv("WHATSAPP_APP_SECRET", "s3cr3t");
    vi.stubEnv("WHATSAPP_BUSINESS_NUMBER", "9665000");
    expect(() => assertConfig()).not.toThrow();
  });
});

describe("simulateAllowed (Audit B2)", () => {
  it("allows inject in dev simulator mode", () => {
    vi.stubEnv("NODE_ENV", "development");
    __setProvider(new SimulatorProvider());
    expect(simulateAllowed()).toBe(true);
  });

  it("blocks inject in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    __setProvider(new SimulatorProvider());
    expect(simulateAllowed()).toBe(false);
  });

  it("blocks inject when the live meta provider is active", () => {
    vi.stubEnv("NODE_ENV", "development");
    __setProvider(new MetaCloudProvider("tok", "pid"));
    expect(simulateAllowed()).toBe(false);
  });
});
