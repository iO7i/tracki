// Slice 14 revenue-by-dimension bench: seeds mobile struggles (with platform +
// app_version) + conversions directly into ClickHouse, then runs the REAL
// revenueByDimension + recoveryByStruggleType queries × the shared
// revenueImpactFrom helper. Asserts the platform / app_version / struggle-type
// recovery cuts, the revenue-struggling filter (money type OR high-intent path),
// and tenancy isolation. Deterministic (no worker timing).
// Run with tsx: node --import tsx bench/revenue-dimension-check.mjs
import {
  createClickHouse,
  insertEvents,
  insertStruggles,
  recoveryByStruggleType,
  revenueByDimension,
} from "@tracki/clickhouse";
import { revenueImpactFrom } from "@tracki/shared";
import postgres from "postgres";

const sql = postgres("postgres://tracki:tracki@localhost:5432/tracki");
const ch = createClickHouse();
let failed = 0;
let passed = 0;
const check = (name, cond, extra = "") => {
  if (cond) passed++;
  else {
    failed++;
    console.error("  FAIL:", name, extra);
  }
};

const now = Date.now();
let seq = 0;
const strug = (org, project, session, type, path, platform, appVersion) => ({
  org_id: org,
  project_id: project,
  anon_id: session,
  user_id: "",
  session_id: session,
  struggle_id: `st_${session}_${seq++}`,
  type,
  severity: "high",
  path,
  element: "visa",
  reason: "seeded",
  event_count: 2,
  score: 80,
  ts: now,
  platform,
  app_version: appVersion,
});
const ev = (org, project, session, type, props = {}, platform = "", appVersion = "") => ({
  org_id: org,
  project_id: project,
  anon_id: session,
  user_id: "",
  session_id: session,
  event_id: `e_${session}_${seq++}`,
  type,
  path: "/checkout",
  url: "https://x.sa/checkout",
  referrer: "",
  props: JSON.stringify(props),
  ua: "",
  ts: now,
  received_at: now,
  platform,
  app_version: appVersion,
  device_model: "",
});
const find = (rows, k, v) => rows.find((r) => r[k] === v);

async function main() {
  const [org] = await sql`
    INSERT INTO organizations (name, slug) VALUES ('RD Org', ${`rd-${now}`}) RETURNING id`;
  const [proj] = await sql`
    INSERT INTO projects (org_id, name, slug, public_key, avg_order_value)
    VALUES (${org.id}, 'RD', ${`rd-${now}`}, ${`pk_rd${now}`.slice(0, 27)}, 200) RETURNING id`;
  const [proj2] = await sql`
    INSERT INTO projects (org_id, name, slug, public_key)
    VALUES (${org.id}, 'RD2', ${`rd2-${now}`}, ${`pk_re${now}`.slice(0, 27)}) RETURNING id`;
  const O = org.id;
  const P = proj.id;
  const RPF = "repeated_payment_failure";

  const struggles = [];
  const events = [];
  // recovered session = struggle + action_impression + purchase (same session).
  const recovered = (s, platform, ver) => {
    struggles.push(strug(O, P, s, RPF, "/checkout", platform, ver));
    events.push(ev(O, P, s, "action_impression", { action_id: "a1", variant: "A" }, platform, ver));
    events.push(ev(O, P, s, "track", { name: "purchase" }, platform, ver));
  };
  const atRisk = (s, platform, ver) => struggles.push(strug(O, P, s, RPF, "/checkout", platform, ver));

  // iOS 2.1.0: 3 at-risk + 1 recovered.
  for (let i = 1; i <= 3; i++) atRisk(`ios_ar${i}`, "ios", "2.1.0");
  recovered("ios_rc1", "ios", "2.1.0");
  // Android 3.0.1: 2 at-risk + 2 recovered.
  for (let i = 1; i <= 2; i++) atRisk(`and_ar${i}`, "android", "3.0.1");
  recovered("and_rc1", "android", "3.0.1");
  recovered("and_rc2", "android", "3.0.1");
  // Negative: rapid_screen_switching on a non-high-intent screen — NOT revenue-struggling.
  struggles.push(strug(O, P, "noise1", "rapid_screen_switching", "/home", "ios", "2.1.0"));
  // Tenancy: a different project's at-risk session must not bleed.
  struggles.push(strug(O, proj2.id, "other1", RPF, "/checkout", "ios", "2.1.0"));

  await insertStruggles(ch, struggles);
  await insertEvents(ch, events);
  await new Promise((r) => setTimeout(r, 800));

  // ── revenueByDimension: platform ──────────────────────────────────────────
  const byPlat = await revenueByDimension(ch, O, P, "platform", 30, "purchase");
  const ios = find(byPlat, "dim", "ios");
  const and = find(byPlat, "dim", "android");
  check("platform ios = struggling 4 / recovered 1 / at_risk 3",
    ios && ios.struggling === "4" && ios.recovered === "1" && ios.at_risk === "3", JSON.stringify(ios));
  check("platform android = struggling 4 / recovered 2 / at_risk 2",
    and && and.struggling === "4" && and.recovered === "2" && and.at_risk === "2", JSON.stringify(and));
  check("rapid_screen_switching on /home excluded (ios not 5)", ios?.struggling === "4");

  // ── revenueByDimension: app_version ───────────────────────────────────────
  const byVer = await revenueByDimension(ch, O, P, "app_version", 30, "purchase");
  const v21 = find(byVer, "dim", "2.1.0");
  const v30 = find(byVer, "dim", "3.0.1");
  check("app_version 2.1.0 = 4/1/3",
    v21 && v21.struggling === "4" && v21.recovered === "1" && v21.at_risk === "3", JSON.stringify(v21));
  check("app_version 3.0.1 = 4/2/2",
    v30 && v30.struggling === "4" && v30.recovered === "2" && v30.at_risk === "2", JSON.stringify(v30));

  // ── recoveryByStruggleType + money math ───────────────────────────────────
  const byType = await recoveryByStruggleType(ch, O, P, 30, "purchase");
  const rpf = find(byType, "struggle_type", RPF);
  check("repeated_payment_failure = struggling 8 / recovered 3 / at_risk 5",
    rpf && rpf.struggling === "8" && rpf.recovered === "3" && rpf.at_risk === "5", JSON.stringify(rpf));
  check("rapid_screen_switching absent from revenue recovery", !find(byType, "struggle_type", "rapid_screen_switching"));

  const money = revenueImpactFrom({ struggling: 8, converted: 3, recovered: 3, atRisk: 5 }, 200);
  check("at-risk money = 5 × 200 = 1000", money.atRiskMoney === 1000, money.atRiskMoney);
  check("recovered money = 3 × 200 = 600", money.recoveredMoney === 600, money.recoveredMoney);

  // ── Tenancy ───────────────────────────────────────────────────────────────
  const t2 = await revenueByDimension(ch, O, proj2.id, "platform", 30, "purchase");
  const t2ios = find(t2, "dim", "ios");
  check("tenancy: project 2 sees only its own session (ios struggling 1, at_risk 1)",
    t2ios && t2ios.struggling === "1" && t2ios.at_risk === "1", JSON.stringify(t2));

  if (failed === 0) console.log(`PASS: revenue-dimension-check ${passed}/${passed} — by platform/app_version/type + tenancy`);
  else console.error(`revenue-dimension-check: ${passed} passed, ${failed} failed`);
  await sql.end();
  await ch.close();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
