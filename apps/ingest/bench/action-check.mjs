// Integration check for slice 3: seeds a live A/B popup, verifies the manifest
// endpoint serves it (client fields only, no schedule), sends impression/click
// tracking events, and asserts the actionResults query reports them.
import { createClient } from "@clickhouse/client";
import postgres from "postgres";

const sql = postgres("postgres://tracki:tracki@localhost:5432/tracki");
const ch = createClient({
  url: "http://localhost:8123",
  username: "tracki",
  password: "tracki",
  database: "tracki",
});

let failed = false;
const fail = (m) => {
  console.error("FAIL:", m);
  failed = true;
};

async function main() {
  const key = `pk_ac${Math.random().toString(36).slice(2, 22)}`.slice(0, 27);
  const [org] = await sql`
    INSERT INTO organizations (name, slug) VALUES ('AC Org', ${`ac-${Date.now()}`}) RETURNING id`;
  const [proj] = await sql`
    INSERT INTO projects (org_id, name, slug, public_key)
    VALUES (${org.id}, 'AC', ${`ac-${Date.now()}`}, ${key}) RETURNING id`;

  const def = {
    type: "popup",
    content: { ar: { title: "مساعدة", body: "هل تحتاج مساعدة؟" }, en: { title: "Help", body: "Need help?" } },
    contentB: { ar: { title: "ب", body: "نسخة ب" }, en: { title: "B", body: "Variant B" } },
    trigger: { kind: "rage_click" },
    urlContains: "/checkout",
    goalEvent: "purchase",
    schedule: { start: "2020-01-01T00:00:00Z" },
  };
  const [act] = await sql`
    INSERT INTO actions (project_id, name, type, status, definition)
    VALUES (${proj.id}, 'Checkout help', 'popup', 'live', ${sql.json(def)}) RETURNING id`;

  // A draft action that must NOT appear in the manifest.
  await sql`
    INSERT INTO actions (project_id, name, type, status, definition)
    VALUES (${proj.id}, 'Draft', 'banner', 'draft', ${sql.json(def)})`;

  // 1) Manifest serves the live action only, with no schedule field leaked.
  const mres = await fetch(`http://localhost:4000/v1/actions?key=${key}`);
  const manifest = await mres.json();
  if (!Array.isArray(manifest.actions) || manifest.actions.length !== 1) {
    fail(`manifest should have exactly 1 live action, got ${manifest.actions?.length}`);
  }
  const entry = manifest.actions?.[0];
  if (entry) {
    if (entry.id !== act.id) fail("manifest action id mismatch");
    if ("schedule" in entry) fail("manifest leaked server-only schedule field");
    if (!entry.contentB) fail("manifest dropped A/B variant");
  }

  // 2) Unknown key → empty manifest (no leak).
  const ures = await fetch("http://localhost:4000/v1/actions?key=pk_unknown_unknown_unknown");
  const umani = await ures.json();
  if ((umani.actions ?? []).length !== 0) fail("unknown key returned actions");

  // 3) Send tracking events (impression + click on variant A, impression on B).
  const ev = (type, variant) => ({
    type,
    ts: Date.now(),
    path: "/checkout",
    url: "https://shop.sa/checkout",
    props: { action_id: act.id, variant },
  });
  await fetch("http://localhost:4000/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key,
      anonId: "anon_a",
      sessionId: "s_a",
      sentAt: Date.now(),
      events: [ev("action_impression", "A"), ev("action_click", "A")],
    }),
  });
  await fetch("http://localhost:4000/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key,
      anonId: "anon_b",
      sessionId: "s_b",
      sentAt: Date.now(),
      events: [ev("action_impression", "B")],
    }),
  });

  await new Promise((r) => setTimeout(r, 2500));

  // 4) actionResults reports per-variant counts.
  const rs = await ch.query({
    query: `SELECT JSONExtractString(props,'variant') AS variant,
                   toString(uniqExactIf(event_id, type='action_impression')) AS impressions,
                   toString(uniqExactIf(event_id, type='action_click')) AS clicks
            FROM events
            WHERE project_id={p:String} AND JSONExtractString(props,'action_id')={a:String}
            GROUP BY variant ORDER BY variant`,
    query_params: { p: proj.id, a: act.id },
    format: "JSONEachRow",
  });
  const rows = await rs.json();
  const a = rows.find((r) => r.variant === "A");
  const b = rows.find((r) => r.variant === "B");
  if (!a || a.impressions !== "1" || a.clicks !== "1") fail(`variant A counts wrong: ${JSON.stringify(a)}`);
  if (!b || b.impressions !== "1") fail(`variant B counts wrong: ${JSON.stringify(b)}`);

  if (!failed) {
    console.log("PASS: manifest serves live action (no schedule leak, A/B kept); unknown key empty;");
    console.log("  results A:", JSON.stringify(a), " B:", JSON.stringify(b));
  }
  await sql.end();
  await ch.close();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  fail(e.message);
  process.exit(1);
});
