import { createClient } from "@clickhouse/client";
// One-shot integration check for slice 1 AC 4/5: seeds a project, sends a batch
// with PII (valid key) + a batch with an unknown key, waits for the worker, then
// asserts ClickHouse has the masked event and dropped the unknown-key event.
import postgres from "postgres";

const sql = postgres("postgres://tracki:tracki@localhost:5432/tracki");
const ch = createClient({
  url: "http://localhost:8123",
  username: "tracki",
  password: "tracki",
  database: "tracki",
});

const fail = (m) => {
  console.error("FAIL:", m);
  process.exitCode = 1;
};

async function main() {
  // Seed an org + project with a known key.
  const key = `pk_e2e${Math.random().toString(36).slice(2, 22)}`.slice(0, 27);
  const [org] = await sql`
    INSERT INTO organizations (name, slug) VALUES ('E2E Org', ${`e2e-${Date.now()}`})
    RETURNING id`;
  const [proj] = await sql`
    INSERT INTO projects (org_id, name, slug, public_key)
    VALUES (${org.id}, 'E2E', ${`p-${Date.now()}`}, ${key}) RETURNING id`;

  const anonId = `anon_e2e_${Date.now()}`;
  const validBatch = {
    key,
    anonId,
    sessionId: "sess_e2e",
    sentAt: Date.now(),
    events: [
      {
        type: "pageview",
        ts: Date.now(),
        url: "https://shop.sa/c?email=secret@buyer.sa",
        path: "/c",
        props: {
          phone: "+966512345678",
          coupon: "SAVE10",
          // Audit B2: PII as an object key.
          "keyholder@bank.sa": 1,
          // Audit B1: PII nested deep.
          a: { b: { c: { d: { e: { f: { g: { h: "deep ahmad@deep.sa" } } } } } } },
        },
      },
    ],
  };
  const unknownBatch = { ...validBatch, key: "pk_totally_unknown_key_000", anonId: `${anonId}_x` };

  for (const b of [validBatch, unknownBatch]) {
    const res = await fetch("http://localhost:4000/v1/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b),
    });
    if (res.status !== 202) fail(`expected 202, got ${res.status}`);
  }

  // Wait for the worker to flush (idle loop ~1s).
  await new Promise((r) => setTimeout(r, 2500));

  const rs = await ch.query({
    query: `SELECT url, props, anon_id FROM events WHERE project_id = {p:String}`,
    query_params: { p: proj.id },
    format: "JSONEachRow",
  });
  const rows = await rs.json();

  // AC5: only the valid-key event is stored.
  if (rows.length !== 1) fail(`expected 1 stored event, got ${rows.length}`);
  // AC4: PII masked.
  const r = rows[0];
  if (r) {
    if (r.url.includes("secret@buyer.sa")) fail("raw email present in url");
    if (r.props.includes("+966512345678")) fail("raw phone present in props");
    if (r.props.includes("keyholder@bank.sa")) fail("raw PII in prop KEY (B2)");
    if (r.props.includes("ahmad@deep.sa")) fail("raw PII nested deep (B1)");
    if (!r.props.includes("SAVE10")) fail("non-PII prop lost");
    if (r.anon_id !== anonId) fail("anon id mismatch");
  }

  if (!process.exitCode) {
    console.log("PASS: valid event stored & PII masked; unknown-key event dropped");
    console.log("  url:  ", r.url);
    console.log("  props:", r.props);
  }

  await sql.end();
  await ch.close();
}

main().catch((e) => {
  fail(e.message);
  process.exit(1);
});
