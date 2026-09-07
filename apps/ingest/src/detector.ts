import { createHash } from "node:crypto";
import {
  HIGH_INTENT_PATH,
  RAGE_MIN_CLICKS,
  RAGE_WINDOW_MS,
  STRUGGLE_WEIGHTS,
  type StoredEvent,
  type StruggleDetection,
  type StruggleType,
  boundLabel,
  clampScore,
  elementSignature,
  severityFromScore,
} from "@tracki/shared";
import type { StateStore } from "./state.js";

// Rule thresholds (rage shared with the snippet via @tracki/shared).
const ERROR_WINDOW_MS = 60_000;
const ERROR_MIN = 2;
const SUBMIT_WINDOW_MS = 90_000;
const SUBMIT_MIN = 2;
const THRASH_WINDOW_MS = 30_000;
const THRASH_MIN = 6;
const DEBOUNCE_MS = 60_000;
const ERROR_FLAG_TTL_MS = 30 * 60_000; // session "has errored" memory

// Mobile rule thresholds (implementation).
const OTP_WINDOW_MS = 5 * 60_000;
const OTP_MIN = 2;
const BIO_WINDOW_MS = 5 * 60_000;
const BIO_MIN = 2;
const PAY_WINDOW_MS = 10 * 60_000;
const PAY_MIN = 2;
const RESTART_WINDOW_MS = 10 * 60_000;
const RESTART_MIN = 3; // cold launches
const SCREEN_THRASH_WINDOW_MS = 30_000;
const SCREEN_THRASH_MIN = 6;
const BACK_WINDOW_MS = 30_000;
const BACK_MIN = 4;
const PERM_WINDOW_MS = 10 * 60_000;
const PERM_MIN = 2; // same permission
// flow_abandon flows that count as onboarding abandonment (registration is
// part of onboarding; checkout/loan/kyc abandons stay events + revenue signals).
const ONBOARDING_FLOWS = new Set(["onboarding", "registration"]);

// Native controls only. Other tags may still have event handlers; this classifier
// measures repeated non-control clicks, not whether the application responded.
const INTERACTIVE = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "option",
  "label",
  "summary",
]);
// High-intent paths score higher — regex shared with Autopilot (implementation).
const HIGH_INTENT = HIGH_INTENT_PATH;

function parseProps(props: string): {
  tag?: string;
  id?: string;
  class?: string;
  message?: string;
  // Mobile (implementation):
  flow?: string;
  permission?: string;
  method?: string;
  launch?: string;
  ok?: boolean;
} {
  try {
    return JSON.parse(props) as Record<string, never>;
  } catch {
    return {};
  }
}

function sig(props: string): string {
  return elementSignature(parseProps(props));
}

function key(e: StoredEvent, ...parts: string[]): string {
  return `sd:${e.org_id}:${e.project_id}:${e.anon_id}:${e.session_id}:${parts.join(":")}`;
}

function pathBonus(path: string): number {
  return HIGH_INTENT.test(path) ? 10 : 0;
}

/** 0–100 score: per-type base + a frequency bonus + path-intent + extras. */
function scoreFor(type: StruggleType, count: number, path: string, extra = 0): number {
  const freq = Math.min(25, Math.max(0, count - 1) * 5);
  return clampScore(STRUGGLE_WEIGHTS[type] + freq + pathBonus(path) + extra);
}

/**
 * Stateless-per-call struggle detector: evaluates a batch of already-stored,
 * already-PII-scrubbed events against per-session sliding windows held in the
 * injected StateStore. Returns detections (deduped via per-(session,type)
 * debounce). Pure logic — no Redis/CH knowledge.
 */
export async function detectBatch(
  store: StateStore,
  events: StoredEvent[],
): Promise<StruggleDetection[]> {
  const out: StruggleDetection[] = [];

  const make = (
    e: StoredEvent,
    type: StruggleType,
    reason: string,
    eventCount: number,
    element = "",
    extra = 0,
  ): StruggleDetection => {
    const score = scoreFor(type, eventCount, e.path, extra);
    return {
      org_id: e.org_id,
      project_id: e.project_id,
      anon_id: e.anon_id,
      user_id: e.user_id,
      session_id: e.session_id,
      struggle_id: createHash("sha256")
        .update(JSON.stringify([e.org_id, e.project_id, e.event_id, type, element]))
        .digest("hex"),
      type,
      severity: severityFromScore(score),
      path: e.path,
      element,
      reason,
      event_count: eventCount,
      score,
      platform: e.platform,
      app_version: e.app_version,
      ts: e.ts,
    };
  };

  for (const e of [...events].sort((a, b) => a.ts - b.ts || a.event_id.localeCompare(b.event_id))) {
    // Ingress validates time. Never collapse event spacing to batch arrival time.
    const t = e.ts;

    if (e.type === "error") {
      await store.setFlag(key(e, "haderr"), ERROR_FLAG_TTL_MS);
      const count = await store.pushTimestamped(key(e, "errwin"), t, ERROR_WINDOW_MS);
      if (
        count >= ERROR_MIN &&
        (await store.setFlagIfAbsent(key(e, "deb", "repeated_error"), DEBOUNCE_MS))
      ) {
        const msg = parseProps(e.props).message?.trim();
        const reason = msg
          ? `${count} errors within 60s: "${msg.slice(0, 80)}"`
          : `${count} errors within 60s`;
        out.push(make(e, "repeated_error", reason, count));
      }
    }

    if (e.type === "click") {
      const s = sig(e.props);
      const tag = (parseProps(e.props).tag ?? "").toLowerCase();
      const count = await store.pushTimestamped(key(e, "rage", s), t, RAGE_WINDOW_MS);
      if (
        count >= RAGE_MIN_CLICKS &&
        (await store.setFlagIfAbsent(key(e, "deb", "rage", s), DEBOUNCE_MS))
      ) {
        // Preserve the legacy dead_click wire name without asserting unresponsiveness.
        const el = tag || "element";
        out.push(
          INTERACTIVE.has(tag)
            ? make(e, "rage_click", `${count} rapid clicks on ${el}`, count, s)
            : make(
                e,
                "dead_click",
                `${count} rapid clicks on ${el}; responsiveness unknown`,
                count,
                s,
              ),
        );
      }
    }

    if (e.type === "form_submit") {
      const s = sig(e.props);
      const count = await store.pushTimestamped(key(e, "submit", s), t, SUBMIT_WINDOW_MS);
      if (
        count >= SUBMIT_MIN &&
        (await store.setFlagIfAbsent(key(e, "deb", "repeated_submit", s), DEBOUNCE_MS))
      ) {
        out.push(
          make(e, "repeated_submit", `Form submitted ${count} times — likely failing`, count, s),
        );
      }
    }

    if (e.type === "pageview") {
      const count = await store.pushTimestamped(key(e, "pv"), t, THRASH_WINDOW_MS);
      if (
        count >= THRASH_MIN &&
        (await store.setFlagIfAbsent(key(e, "deb", "thrashing"), DEBOUNCE_MS))
      ) {
        out.push(make(e, "thrashing", `${count} pageviews within 30s`, count));
      }
    }

    if (e.type === "form_abandon") {
      if (await store.setFlagIfAbsent(key(e, "deb", "form_abandon"), DEBOUNCE_MS)) {
        const errored = await store.hasFlag(key(e, "haderr"));
        out.push(
          make(
            e,
            "form_abandon",
            errored ? "Form abandoned after an error" : "Form abandoned without submitting",
            1,
            sig(e.props),
            errored ? 25 : 0,
          ),
        );
      }
    }

    // ── Mobile rules (implementation) — same windowing/debounce machinery ──────

    if (e.type === "otp_fail") {
      const count = await store.pushTimestamped(key(e, "otp"), t, OTP_WINDOW_MS);
      if (
        count >= OTP_MIN &&
        (await store.setFlagIfAbsent(key(e, "deb", "otp_failure_loop"), DEBOUNCE_MS))
      ) {
        out.push(
          make(
            e,
            "otp_failure_loop",
            `${count} OTP failures within 5min`,
            count,
            boundLabel("otp"),
          ),
        );
      }
    }

    if (e.type === "biometric_fail") {
      const count = await store.pushTimestamped(key(e, "bio"), t, BIO_WINDOW_MS);
      if (
        count >= BIO_MIN &&
        (await store.setFlagIfAbsent(key(e, "deb", "biometric_failure_loop"), DEBOUNCE_MS))
      ) {
        out.push(
          make(
            e,
            "biometric_failure_loop",
            `${count} biometric failures within 5min`,
            count,
            boundLabel("biometric"),
          ),
        );
      }
    }

    if (e.type === "payment_fail") {
      const count = await store.pushTimestamped(key(e, "pay"), t, PAY_WINDOW_MS);
      if (
        count >= PAY_MIN &&
        (await store.setFlagIfAbsent(key(e, "deb", "repeated_payment_failure"), DEBOUNCE_MS))
      ) {
        const method = parseProps(e.props).method?.trim();
        out.push(
          make(
            e,
            "repeated_payment_failure",
            method
              ? `${count} payment failures within 10min (${method.slice(0, 40)})`
              : `${count} payment failures within 10min`,
            count,
            boundLabel(method || "payment"),
          ),
        );
      }
    }

    if (e.type === "app_foreground" && parseProps(e.props).launch === "cold") {
      // Cold launches keyed on the VISITOR, not the session — each restart
      // typically begins a new session, which would reset a session window.
      const restartKey = `sd:${e.org_id}:${e.project_id}:anon:${e.anon_id}:restart`;
      const count = await store.pushTimestamped(restartKey, t, RESTART_WINDOW_MS);
      if (count >= RESTART_MIN && (await store.setFlagIfAbsent(`${restartKey}:deb`, DEBOUNCE_MS))) {
        out.push(make(e, "app_restart_loop", `${count} cold app starts within 10min`, count));
      }
    }

    if (e.type === "screen_view") {
      const count = await store.pushTimestamped(key(e, "sv"), t, SCREEN_THRASH_WINDOW_MS);
      if (
        count >= SCREEN_THRASH_MIN &&
        (await store.setFlagIfAbsent(key(e, "deb", "rapid_screen_switching"), DEBOUNCE_MS))
      ) {
        out.push(make(e, "rapid_screen_switching", `${count} screen switches within 30s`, count));
      }
    }

    if (e.type === "back_nav") {
      const count = await store.pushTimestamped(key(e, "back"), t, BACK_WINDOW_MS);
      if (
        count >= BACK_MIN &&
        (await store.setFlagIfAbsent(key(e, "deb", "repeated_back_navigation"), DEBOUNCE_MS))
      ) {
        out.push(
          make(e, "repeated_back_navigation", `${count} back navigations within 30s`, count),
        );
      }
    }

    if (e.type === "permission_denied") {
      const perm = boundLabel((parseProps(e.props).permission ?? "permission").toLowerCase());
      const count = await store.pushTimestamped(key(e, "perm", perm), t, PERM_WINDOW_MS);
      if (
        count >= PERM_MIN &&
        (await store.setFlagIfAbsent(key(e, "deb", "permission_denial_loop", perm), DEBOUNCE_MS))
      ) {
        out.push(
          make(
            e,
            "permission_denial_loop",
            `"${perm}" permission denied ${count} times within 10min`,
            count,
            perm,
          ),
        );
      }
    }

    if (e.type === "deep_link" && parseProps(e.props).ok === false) {
      if (await store.setFlagIfAbsent(key(e, "deb", "deep_link_failure"), DEBOUNCE_MS)) {
        out.push(make(e, "deep_link_failure", "Deep link failed to resolve", 1));
      }
    }

    if (e.type === "flow_abandon") {
      const flow = (parseProps(e.props).flow ?? "").toLowerCase();
      if (
        ONBOARDING_FLOWS.has(flow) &&
        (await store.setFlagIfAbsent(key(e, "deb", "onboarding_abandonment"), DEBOUNCE_MS))
      ) {
        out.push(
          make(e, "onboarding_abandonment", `Abandoned the ${flow} flow`, 1, boundLabel(flow)),
        );
      }
    }
  }

  return out;
}
