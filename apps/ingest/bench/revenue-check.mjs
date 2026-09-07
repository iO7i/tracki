// Slice 13 Revenue Impact bench: seeds checkout struggles + conversions directly
// into ClickHouse (deterministic — no worker timing), then runs the REAL
// revenueImpact / revenueByPath queries and the shared revenueImpactFrom helper.
// Asserts at-risk/recovered/struggling counts, high-intent filtering, conversion
// detection (track + action_goal), and tenancy isolation.
// Run with tsx (imports workspace TS): node --import tsx bench/revenue-check.mjs
import { createClickHouse, insertEvents, insertStruggles, revenueByPath, revenueImpact } from "@tracki/clickhouse";
import { revenueImpactFrom } from "@tracki/shared";
import postgres from "postgres";

const sql = postgres("postgres://tracki:tracki@localhost:5432/tracki");
const ch = createClickHouse();
let failed = 0;
let passed = 0;
const check = (name, cond, extra) => {
  if (cond) passed++;
  else {
    failed++;
    console.error("  FAIL:", name, extra ?? "");
  }
};

const now = Date.now();
let seq = 0;
const ev = (org, project, session, type, path, props = {}) => ({
  org_id: org,
  project_id: project,
  anon_id: session,
  user_id: "",
  session_id: session,
  event_id: `e_${session}_${seq++}`,
  type,
  path,
  url: `https://x.sa${path}`,
  referrer: "",
  props: JSON.stringify(props),
  ua: "Chrome",
  ts: now,
  received_at: now,
});
const strug = (org, project, session, path, ts = now) => ({
  org_id: org,
  project_id: project,
  anon_id: session,
  user_id: "",
  session_id: session,
  struggle_id: `st_${session}_${seq++}`,
  type: "rage_click",
  severity: "medium",
  path,
  element: "button|pay|cta",
  reason: "rage click",
  event_count: 3,
  score: 50,
  ts,
});

async function main() {
  const [org] = await sql`INSERT INTO organizations (name, slug) VALUES ('Rev Bench', ${`rb-${now}`}) RETURNING id`;
  const [proj] = await sql`INSERT INTO projects (org_id, name, slug, public_key) VALUES (${org.id}, 'P', ${`p-${now}`}, ${`pk_rb${now}`.slice(0, 27)}) RETURNING id`;
  const [proj2] = await sql`INSERT INTO projects (org_id, name, slug, public_key) VALUES (${org.id}, 'P2', ${`p2-${now}`}, ${`pk_rc${now}`.slice(0, 27)}) RETURNING id`;
  const O = org.id;
  const P = proj.id;

  const struggles = [];
  const events = [];

  // 4 at-risk: struggle on /checkout, no conversion.
  for (let i = 1; i <= 4; i++) struggles.push(strug(O, P, `risk${i}`, "/checkout"));
  // 3 recovered: struggle on /checkout + action_impression + track purchase.
  for (let i = 1; i <= 3; i++) {
    struggles.push(strug(O, P, `rec${i}`, "/checkout"));
    events.push(ev(O, P, `rec${i}`, "action_impression", "/checkout", { action_id: "a1", variant: "A" }));
    events.push(ev(O, P, `rec${i}`, "track", "/checkout", { name: "purchase" }));
  }
  // 1 organically converted (struggle + purchase, NO impression): converted, not recovered, not at-risk.
  struggles.push(strug(O, P, "org1", "/checkout"));
  events.push(ev(O, P, "org1", "track", "/checkout", { name: "purchase" }));
  // 1 non-high-intent struggle (/about): excluded entirely.
  struggles.push(strug(O, P, "about1", "/about"));
  // Tenancy: an at-risk session under a DIFFERENT project — must not bleed in.
  struggles.push(strug(O, proj2.id, "other1", "/checkout"));

  await insertStruggles(ch, struggles);
  await insertEvents(ch, events);
  // ClickHouse inserts are async-visible; small settle.
  await new Promise((r) => setTimeout(r, 800));

  const tot = await revenueImpact(ch, O, P, 30, "purchase");
  const counts = {
    struggling: Number(tot.struggling),
    converted: Number(tot.converted),
    recovered: Number(tot.recovered),
    atRisk: Number(tot.at_risk),
  };

  check("struggling = 8 (high-intent only, /about excluded)", counts.struggling === 8, counts.struggling);
  check("converted = 4 (3 recovered + 1 organic)", counts.converted === 4, counts.converted);
  check("recovered = 3 (struggle + impression + purchase)", counts.recovered === 3, counts.recovered);
  check("at_risk = 4", counts.atRisk === 4, counts.atRisk);

  const impact = revenueImpactFrom(counts, 100);
  check("atRiskMoney = 400", impact.atRiskMoney === 400, impact.atRiskMoney);
  check("recoveredMoney = 300", impact.recoveredMoney === 300, impact.recoveredMoney);
  check("recoveryRate = 3/7", Math.abs(impact.recoveryRate - 3 / 7) < 1e-9, impact.recoveryRate);

  const paths = await revenueByPath(ch, O, P, 30, "purchase", 6);
  const checkout = paths.find((p) => p.path === "/checkout");
  check("byPath /checkout struggling = 8", checkout && Number(checkout.struggling) === 8, checkout?.struggling);
  check("byPath /checkout at_risk = 4", checkout && Number(checkout.at_risk) === 4, checkout?.at_risk);
  check("byPath excludes /about", !paths.some((p) => p.path === "/about"));

  // Tenancy: project 2 sees only its own one at-risk session, not project 1's.
  const tot2 = await revenueImpact(ch, O, proj2.id, 30, "purchase");
  check("tenancy: project 2 struggling = 1", Number(tot2.struggling) === 1, tot2.struggling);
  check("tenancy: project 2 at_risk = 1", Number(tot2.at_risk) === 1, tot2.at_risk);

  if (failed === 0) console.log(`PASS: revenue-check ${passed}/${passed} — SAR 400 at risk / 300 recovered / 43%`);
  else console.error(`revenue-check: ${passed} passed, ${failed} failed`);
  await sql.end();
  await ch.close();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
