import { z } from "zod";

/**
 * Revenue Impact (slice 13) — turn measured friction into money. Pure model +
 * settings schema; the heavy lifting (sessionized counts) is in ClickHouse and
 * the merchant-set AOV/currency live on the project. No I/O here.
 */

/** GCC-first currency allow-list (ISO-4217). */
export const CURRENCIES = ["SAR", "AED", "QAR", "KWD", "BHD", "OMR", "EGP", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const revenueSettingsSchema = z.object({
  currency: z.enum(CURRENCIES),
  // Major currency units (e.g. 250 = 250 SAR). 0 ⇒ "not set" (no fabricated money).
  avgOrderValue: z.coerce.number().int().min(0).max(1_000_000),
  conversionEvent: z.string().trim().min(1, "errors.required").max(80, "errors.tooLong"),
});
export type RevenueSettings = z.infer<typeof revenueSettingsSchema>;

/** Sessionized counts from ClickHouse (all distinct-session over the window). */
export interface RevenueCounts {
  /** Sessions with ≥1 struggle on a high-intent path. */
  struggling: number;
  /** Of those, sessions that converted (conversion event or action goal). */
  converted: number;
  /** Struggling sessions that saw an action and then converted. */
  recovered: number;
  /** Struggling sessions that did not convert. */
  atRisk: number;
}

export interface RevenueImpact {
  atRiskMoney: number;
  recoveredMoney: number;
  /** recovered / (recovered + atRisk); 0 when neither — the share we saved vs lost. */
  recoveryRate: number;
}

/** Money = measured session counts × merchant AOV. Correlation, not causation. */
export function revenueImpactFrom(counts: RevenueCounts, aov: number): RevenueImpact {
  const safeAov = Math.max(0, Math.floor(aov));
  const denom = counts.recovered + counts.atRisk;
  return {
    atRiskMoney: Math.max(0, counts.atRisk) * safeAov,
    recoveredMoney: Math.max(0, counts.recovered) * safeAov,
    recoveryRate: denom > 0 ? counts.recovered / denom : 0,
  };
}
