import { clampScore } from "./struggles";

/**
 * Mobile Journey Score (implementation) — a 0–100 per-session health score.
 *
 * Deterministic and explainable, NOT a trained model: it folds the session's
 * measured friction (summed struggle scores), funnel abandonment and completion
 * signals into one number. The companion "probabilities" are a documented
 * monotone mapping of the score (converted sessions pin to 1/0) — a heuristic,
 * never presented as a calibrated prediction (house rule: no fabricated
 * numbers; the dashboard labels it as a friction-derived estimate).
 */

export interface JourneySignals {
  /** Sum of 0–100 struggle scores detected in the session. */
  struggleScoreSum: number;
  /** flow_abandon events in the session (checkout/registration/loan/kyc/onboarding). */
  flowsAbandoned: number;
  /** flow_complete events in the session. */
  flowsCompleted: number;
  /** Session converted (project conversion event or action_goal). */
  converted: boolean;
}

export interface JourneyScore {
  /** 0–100; 100 = frictionless. */
  score: number;
  /** Heuristic 0–1, monotone in score; 1 when converted. */
  completionProbability: number;
  /** Heuristic 0–1 = 1 − completionProbability. */
  abandonProbability: number;
}

// Tuned so one low-grade struggle dents but doesn't tank a session, while an
// auth/payment loop (75–80) or an abandoned funnel drags it into the red.
const FRICTION_FACTOR = 0.35;
const FRICTION_CAP = 55;
const ABANDON_PENALTY = 15;
const ABANDON_CAP = 30;
const CONVERTED_BONUS = 20;
const COMPLETED_FLOW_BONUS = 5;
const COMPLETED_FLOW_CAP = 10;

export function journeyScore(s: JourneySignals): JourneyScore {
  const friction = Math.min(FRICTION_CAP, Math.max(0, s.struggleScoreSum) * FRICTION_FACTOR);
  const abandon = Math.min(ABANDON_CAP, Math.max(0, s.flowsAbandoned) * ABANDON_PENALTY);
  const bonus =
    (s.converted ? CONVERTED_BONUS : 0) +
    Math.min(COMPLETED_FLOW_CAP, Math.max(0, s.flowsCompleted) * COMPLETED_FLOW_BONUS);
  const score = clampScore(100 - friction - abandon + bonus);
  const completionProbability = s.converted ? 1 : Math.round(score) / 100;
  return {
    score,
    completionProbability: round2(completionProbability),
    abandonProbability: round2(1 - completionProbability),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
