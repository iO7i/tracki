/**
 * Mobile/web envelope compatibility is deliberately explicit. Version 1
 * accepts the current envelope and legacy envelopes without a version field;
 * future versions must be negotiated instead of being silently misparsed.
 */
export const PROTOCOL_VERSION = 1 as const;
export const MIN_SUPPORTED_PROTOCOL_VERSION = 1 as const;

export type ProtocolCompatibility =
  | { accepted: true; mode: "current" | "legacy"; version: number }
  | { accepted: false; mode: "unsupported"; version: number };

export function protocolCompatibility(version: number | undefined): ProtocolCompatibility {
  if (version === undefined) {
    return { accepted: true, mode: "legacy", version: MIN_SUPPORTED_PROTOCOL_VERSION };
  }
  if (version === PROTOCOL_VERSION) {
    return { accepted: true, mode: "current", version };
  }
  return { accepted: false, mode: "unsupported", version };
}
