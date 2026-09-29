/** Explicit correlation metadata, separate from arbitrary properties. Never authentication. */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}
export function sanitizeTraceContext(value: unknown): TraceContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const valid = (x: unknown, n: number): x is string =>
    typeof x === "string" && new RegExp(`^(?!0+$)[a-f0-9]{${n}}$`).test(x);
  if (
    !valid(v.traceId, 32) ||
    !valid(v.spanId, 16) ||
    (v.parentSpanId !== undefined && !valid(v.parentSpanId, 16))
  )
    return undefined;
  return {
    traceId: v.traceId,
    spanId: v.spanId,
    ...(v.parentSpanId === undefined ? {} : { parentSpanId: v.parentSpanId as string }),
  };
}
