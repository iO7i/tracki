// implementation Mobile Journey Intelligence e2e over the REAL stack — drives the
// actual @tracki/mobile-core SDK engine (the protocol reference every native
// SDK mirrors) against the running ingest service, then asserts ClickHouse:
//   1) mobile events land with device context (platform/app_version/model)
//   2) PII inside mobile props is masked at ingestion (email + Luhn PAN)
//   3) the detector fires mobile struggle types (otp_failure_loop,
//      repeated_payment_failure) carrying platform/app_version
//   4) server-driven Live Assist round-trips: struggle → stash → next flush
//      pops the assist into the SDK renderer → assist_shown lands
//   5) the action manifest filters by surface (web never sees mobile drawers)
//   6) action engine emits impression/goal through the real pipeline
//   7) sessionJourneys + the shared journeyScore produce sane session scores
//   8) recoveryByStruggleType counts the recovered payment session
// Requires the stack + ingest running. Run: node --import tsx bench/mobile-check.mjs
import { createTracki } from "@tracki/mobile-core";
import {
  createClickHouse,
  recoveryByStruggleType,
  sessionJourneys,
} from "@tracki/clickhouse";
import { journeyScore } from "@tracki/shared";
import postgres from "postgres";

const INGEST = "http://localhost:4000";
const sql = postgres("postgres://tracki:tracki@localhost:5432/tracki");
const ch = createClickHouse();

let failed = 0;
let passed = 0;
const check = (name, cond, extra = "") => {
  if (cond) {
    passed++;
    console.log("  ok:", name);
  } else {
    failed++;
    console.error("  FAIL:", name, extra);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function memoryStorage() {
  const data = new Map();
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => {
      data.set(k, v);
    },
  };
}

const loc = (title, body, cta) => ({ title, body, ...(cta ? { cta } : {}) });

async function main() {
  // ── Seed: project + actions ────────────────────────────────────────────────
  const key = `pk_mb${Math.random().toString(36).slice(2, 22)}`.slice(0, 27);
  const [org] = await sql`
    INSERT INTO organizations (name, slug) VALUES ('MB Org', ${`mb-${Date.now()}`}) RETURNING id`;
  const [proj] = await sql`
    INSERT INTO projects (org_id, name, slug, public_key, avg_order_value)
    VALUES (${org.id}, 'MB', ${`mb-${Date.now()}`}, ${key}, 350) RETURNING id`;

  // Live Assist action for the mobile auth/payment loops (server-driven).
  await sql`
    INSERT INTO actions (project_id, name, type, status, definition)
    VALUES (${proj.id}, 'OTP rescue', 'drawer', 'live', ${sql.json({
      type: "drawer",
      surface: "mobile",
      content: {
        ar: loc("هل تحتاج مساعدة في استلام الرمز؟", "اطلب رمزًا جديدًا أو تواصل معنا.", {
          label: "تواصل عبر واتساب",
          kind: "whatsapp",
        }),
        en: loc("Need help receiving your code?", "Request a new code or contact us.", {
          label: "Chat on WhatsApp",
          kind: "whatsapp",
        }),
      },
      trigger: { kind: "struggle" },
      struggleTypes: ["otp_failure_loop", "repeated_payment_failure"],
    })})`;

  // Mobile-surface drawer shown on the Checkout screen (impression source).
  await sql`
    INSERT INTO actions (project_id, name, type, status, definition)
    VALUES (${proj.id}, 'Checkout helper', 'drawer', 'live', ${sql.json({
      type: "drawer",
      surface: "mobile",
      content: {
        ar: loc("جرّب مدى", "ادفع بمدى لإتمام أسرع."),
        en: loc("Try Mada", "Pay with Mada for a faster checkout."),
      },
      trigger: { kind: "pageview" },
      urlContains: "Checkout",
      goalEvent: "purchase",
    })})`;

  // Web-only popup — must NEVER appear in the mobile manifest.
  await sql`
    INSERT INTO actions (project_id, name, type, status, definition)
    VALUES (${proj.id}, 'Web popup', 'popup', 'live', ${sql.json({
      type: "popup",
      surface: "web",
      content: { ar: loc("عرض", "خصم"), en: loc("Offer", "Discount") },
      trigger: { kind: "pageview" },
    })})`;

  // ── 5) Manifest surface filtering ─────────────────────────────────────────
  const webManifest = await (await fetch(`${INGEST}/v1/actions?key=${key}`)).json();
  const mobManifest = await (
    await fetch(`${INGEST}/v1/actions?key=${key}&surface=mobile`)
  ).json();
  const webTypes = webManifest.actions.map((a) => a.type);
  const mobNames = mobManifest.actions.map((a) => a.urlContains ?? "");
  check("web manifest has the popup only", webTypes.length === 1 && webTypes[0] === "popup");
  check(
    "mobile manifest has the drawer, not the web popup, never struggle actions",
    mobManifest.actions.length === 1 && mobNames[0] === "Checkout",
    JSON.stringify(mobManifest),
  );

  // ── SDK client A: OTP failure loop → Live Assist round-trip ──────────────
  const intentsA = [];
  const a = await createTracki({
    key,
    endpoint: INGEST,
    locale: "ar",
    device: { platform: "ios", osVersion: "17.4", appVersion: "2.1.0", model: "iPhone15,2", sdk: "react-native" },
    storage: memoryStorage(),
    renderer: { show: (i) => intentsA.push(i) },
    openUrl: () => {},
  });
  await a.ready;
  a.screen("Login");
  a.screen("Otp");
  a.otp("start");
  a.otp("fail");
  a.otp("fail");
  // 2) PII in mobile props must be masked at ingestion.
  a.track("support_note", { note: "reach me at buyer@shop.sa, card 4242424242424242" });
  await a.flush();

  await sleep(3000); // worker: insert + detect + arm assist

  a.track("still_here"); // next flush pops the armed assist
  await a.flush();
  await sleep(500);
  const assist = intentsA.find((i) => i.intent === "assist");
  check("Live Assist popped into the SDK renderer after the OTP loop", !!assist);
  if (assist) {
    check(
      "assist carries the authored Arabic content",
      assist.title.length > 0 && typeof assist.escalate === "function",
      assist.title,
    );
  }
  await a.flush();

  // ── SDK client B: payment failures + impression + conversion (recovered) ──
  const intentsB = [];
  const b = await createTracki({
    key,
    endpoint: INGEST,
    locale: "ar",
    device: { platform: "android", osVersion: "14", appVersion: "3.0.1", model: "SM-S918B", sdk: "android" },
    storage: memoryStorage(),
    renderer: { show: (i) => intentsB.push(i) },
    openUrl: () => {},
  });
  await b.ready;
  b.screen("Home");
  b.screen("Checkout"); // → drawer impression (manifest action)
  check(
    "action engine rendered the Checkout drawer",
    intentsB.some((i) => i.intent === "action" && i.type === "drawer"),
  );
  b.payment("start", { method: "visa" });
  b.payment("fail", { method: "visa" });
  b.payment("fail", { method: "visa" });
  b.flow("start", "checkout");
  b.track("purchase"); // conversion + action goal
  b.flow("complete", "checkout");
  await b.flush();

  await sleep(3500); // worker round

  // ── 1) Device context on events ───────────────────────────────────────────
  const evRows = await (
    await ch.query({
      query: `SELECT type, platform, app_version, device_model, props FROM events
              WHERE project_id={p:String} ORDER BY ts ASC LIMIT 1 BY event_id`,
      query_params: { p: proj.id },
      format: "JSONEachRow",
    })
  ).json();
  const otpFail = evRows.find((r) => r.type === "otp_fail");
  check(
    "mobile events land with platform/app_version/model",
    otpFail?.platform === "ios" && otpFail?.app_version === "2.1.0" && otpFail?.device_model === "iPhone15,2",
    JSON.stringify(otpFail),
  );
  const types = new Set(evRows.map((r) => r.type));
  for (const t of ["screen_view", "screen_leave", "app_foreground", "payment_fail", "flow_complete", "action_impression", "action_goal", "assist_shown"]) {
    check(`event type ${t} flowed through the pipeline`, types.has(t));
  }

  // ── 2) PII masking ────────────────────────────────────────────────────────
  const note = evRows.find((r) => r.type === "track" && r.props.includes("note"));
  check(
    "email + PAN masked inside mobile props",
    !!note && !note.props.includes("buyer@shop.sa") && !note.props.includes("4242424242424242"),
    note?.props,
  );

  // ── 3) Mobile struggle types with device context ──────────────────────────
  const stRows = await (
    await ch.query({
      query: `SELECT type, severity, element, score, platform, app_version FROM struggles
              WHERE project_id={p:String}`,
      query_params: { p: proj.id },
      format: "JSONEachRow",
    })
  ).json();
  const otp = stRows.find((r) => r.type === "otp_failure_loop");
  check("otp_failure_loop detected (high, element otp, ios 2.1.0)",
    otp?.severity === "high" && otp?.element === "otp" && otp?.platform === "ios" && otp?.app_version === "2.1.0",
    JSON.stringify(otp));
  const pay = stRows.find((r) => r.type === "repeated_payment_failure");
  check("repeated_payment_failure detected with method element",
    pay?.severity === "high" && pay?.element === "visa" && pay?.platform === "android",
    JSON.stringify(pay));

  // ── 7) Journey scores over real sessions ──────────────────────────────────
  const journeys = await sessionJourneys(ch, org.id, proj.id, 30, "purchase", 20);
  check("sessionJourneys returns both mobile sessions", journeys.length >= 2, `${journeys.length}`);
  const converted = journeys.find((j) => j.converted === "1");
  const struggledOnly = journeys.find((j) => j.converted === "0" && Number(j.friction) > 0);
  if (converted && struggledOnly) {
    const sc = journeyScore({
      struggleScoreSum: Number(converted.friction),
      flowsAbandoned: Number(converted.abandoned_flows),
      flowsCompleted: Number(converted.completed_flows),
      converted: true,
    });
    const sn = journeyScore({
      struggleScoreSum: Number(struggledOnly.friction),
      flowsAbandoned: Number(struggledOnly.abandoned_flows),
      flowsCompleted: Number(struggledOnly.completed_flows),
      converted: false,
    });
    check("converted session outscores the struggling non-converted one",
      sc.score > sn.score && sc.completionProbability === 1 && sn.abandonProbability > 0,
      `${sc.score} vs ${sn.score}`);
  } else {
    check("journey rollup separates converted vs struggling sessions", false, JSON.stringify(journeys));
  }

  // ── 8) Revenue recovery by struggle type ──────────────────────────────────
  const recovery = await recoveryByStruggleType(ch, org.id, proj.id, 30, "purchase");
  const payRec = recovery.find((r) => r.struggle_type === "repeated_payment_failure");
  check("payment session counted as RECOVERED (struggled → impression → converted)",
    payRec && Number(payRec.recovered) >= 1, JSON.stringify(recovery));
  const otpRec = recovery.find((r) => r.struggle_type === "otp_failure_loop");
  check("otp session NOT revenue-struggling (low-intent screen, not a money type)",
    !otpRec, JSON.stringify(otpRec ?? null));

  console.log(failed === 0 ? `PASS: ${passed}/${passed + failed} mobile checks` : `FAILED: ${failed} of ${passed + failed}`);
  await sql.end();
  await ch.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
