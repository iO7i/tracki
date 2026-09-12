import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  protocolCompatibility,
} from "./protocol";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../sdks/conformance/protocol-compatibility.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: Array<{ name: string; version?: number; accepted: boolean; mode: string }>;
};

describe("event protocol compatibility", () => {
  it("accepts the current version", () => {
    expect(protocolCompatibility(PROTOCOL_VERSION)).toEqual({
      accepted: true,
      mode: "current",
      version: 1,
    });
  });

  it("accepts legacy envelopes without silently calling them current", () => {
    expect(protocolCompatibility(undefined)).toEqual({
      accepted: true,
      mode: "legacy",
      version: MIN_SUPPORTED_PROTOCOL_VERSION,
    });
  });

  it("rejects unsupported versions", () => {
    expect(protocolCompatibility(PROTOCOL_VERSION + 1)).toEqual({
      accepted: false,
      mode: "unsupported",
      version: 2,
    });
  });

  it.each(fixture.cases)("matches shared fixture: $name", (testCase) => {
    const result = protocolCompatibility(testCase.version);
    expect(result.accepted).toBe(testCase.accepted);
    expect(result.mode).toBe(testCase.mode);
  });
});
