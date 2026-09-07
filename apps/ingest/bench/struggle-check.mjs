// Integration check for slice 2: seeds a project, sends event batches that
// should trigger each struggle type, waits for the worker+detector, then asserts
// ClickHouse `struggles` has the expected types/severities. Also checks segment
// evaluation. Requires the stack + ingest running.
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

const post = (body) =>
  fetch("http://localhost:4000/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function main() {
  const key = `pk_sd${Math.random().toString(36).slice(2, 22)}`.slice(0, 27);
  const [org] = await sql`
    INSERT INTO organizations (name, slug) VALUES ('SD Org', ${`sd-${Date.now()}`}) RETURNING id`;
  const [proj] = await sql`
    INSERT INTO projects (org_id, name, slug, public_key)
    VALUES (${org.id}, 'SD', ${`sd-${Date.now()}`}, ${key}) RETURNING id`;

  const base = Date.now();
  const click = JSON.stringify({ tag: "button", id: "buy", class: "cta" });

  // Rager: 3 fast clicks same element.
  await post({
    key,
    anonId: "anon_rage",
    sessionId: "s_rage",
    sentAt: base,
    events: [0, 300, 600].map((d) => ({ type: "click", ts: base + d, path: "/p", props: { tag: "button", id: "buy", class: "cta" } })),
  });

  // Dead-clicker (slice 11): 3 fast clicks on a NON-interactive element → dead_click.
  await post({
    key,
    anonId: "anon_dead",
    sessionId: "s_dead",
    sentAt: base,
    events: [0, 300, 600].map((d) => ({
      type: "click",
      ts: base + d,
      path: "/p",
      props: { tag: "div", class: "fake-btn" },
    })),
  });

  // Re-submitter (slice 11): same form submitted twice within the window.
  await post({
    key,
    anonId: "anon_sub",
    sessionId: "s_sub",
    sentAt: base,
    events: [0, 4000].map((d) => ({
      type: "form_submit",
      ts: base + d,
      path: "/checkout",
      props: { tag: "form", id: "checkout" },
    })),
  });

  // Errored + abandoned (should be HIGH).
  await post({
    key,
    anonId: "anon_ab",
    userId: "user_ab",
    sessionId: "s_ab",
    sentAt: base,
    events: [
      { type: "error", ts: base, path: "/checkout", props: { message: "boom" } },
      { type: "form_abandon", ts: base + 2000, path: "/checkout", props: { tag: "form" } },
    ],
  });

  await new Promise((r) => setTimeout(r, 3000));

  const rs = await ch.query({
    query: `SELECT type, severity, anon_id, element, score FROM struggles WHERE project_id={p:String}`,
    query_params: { p: proj.id },
    format: "JSONEachRow",
  });
  const rows = await rs.json();
  const types = new Set(rows.map((r) => r.type));

  if (!types.has("rage_click")) fail("rage_click not detected");
  if (!types.has("dead_click")) fail("dead_click not detected");
  if (!types.has("repeated_submit")) fail("repeated_submit not detected");
  const ab = rows.find((r) => r.type === "form_abandon");
  if (!ab) fail("form_abandon not detected");
  else if (ab.severity !== "high") fail(`form_abandon severity ${ab.severity}, expected high`);

  // Slice 11: element + numeric score recorded.
  const rage = rows.find((r) => r.type === "rage_click");
  if (rage && (rage.element !== "button|buy|cta" || Number(rage.score) <= 0))
    fail(`rage element/score missing: ${rage.element} / ${rage.score}`);
  const sub = rows.find((r) => r.type === "repeated_submit");
  if (sub && sub.severity !== "high") fail(`repeated_submit severity ${sub.severity}, expected high`);

  // Segment: form_abandon AND identified → should match anon_ab (user_ab).
  const ids = new Set();
  for (const q of [
    `SELECT DISTINCT anon_id FROM struggles WHERE project_id={p:String} AND type='form_abandon'`,
    `SELECT DISTINCT anon_id FROM events WHERE project_id={p:String} AND user_id != ''`,
  ]) {
    const r = await ch.query({ query: q, query_params: { p: proj.id }, format: "JSONEachRow" });
    const set = new Set((await r.json()).map((x) => x.anon_id));
    if (ids.size === 0) for (const x of set) ids.add(x);
    else for (const x of [...ids]) if (!set.has(x)) ids.delete(x);
  }
  if (!ids.has("anon_ab")) fail("segment intersection did not match the identified abandoner");

  if (!failed) {
    console.log("PASS: struggles detected", [...types].join(", "));
    console.log("  form_abandon severity:", ab?.severity);
    console.log("  segment (abandon AND identified) visitors:", ids.size);
  }
  await sql.end();
  await ch.close();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  fail(e.message);
  process.exit(1);
});
