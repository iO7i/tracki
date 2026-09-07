// Slice-11 hardening integration check: sends rage clicks whose element id
// carries PII (email + a Luhn-valid PAN) and an oversized/bidi id, then asserts
// the stored struggle `element` is masked, length-bounded, and control-clean.
// Requires the stack + ingest running. Run: node bench/harden-check.mjs
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

const isUnsafe = (c) =>
  c <= 0x1f || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e);

async function main() {
  const key = `pk_hd${Math.random().toString(36).slice(2, 22)}`.slice(0, 27);
  const [org] = await sql`
    INSERT INTO organizations (name, slug) VALUES ('HD Org', ${`hd-${Date.now()}`}) RETURNING id`;
  const [proj] = await sql`
    INSERT INTO projects (org_id, name, slug, public_key)
    VALUES (${org.id}, 'HD', ${`hd-${Date.now()}`}, ${key}) RETURNING id`;

  const base = Date.now();
  // id smuggles an email + a Luhn-valid test PAN plus a bidi-override (U+202E)
  // and a NUL; class is oversized — all must be masked / stripped / bounded.
  const evilId = `user-leak@corp.sa-4111111111111111${String.fromCharCode(0x202e)}${String.fromCharCode(0)}`;
  const longClass = "x".repeat(400);
  await post({
    key,
    anonId: "anon_hd",
    sessionId: "s_hd",
    sentAt: base,
    events: [0, 300, 600].map((d) => ({
      type: "click",
      ts: base + d,
      path: "/checkout",
      props: { tag: "button", id: evilId, class: longClass },
    })),
  });

  await new Promise((r) => setTimeout(r, 3000));

  const rs = await ch.query({
    query: `SELECT element FROM struggles WHERE project_id={p:String} AND type='rage_click'`,
    query_params: { p: proj.id },
    format: "JSONEachRow",
  });
  const rows = await rs.json();
  if (rows.length === 0) fail("no rage_click stored");
  const el = rows[0]?.element ?? "";

  // F3 — PII masked: no raw email, no raw PAN.
  if (el.includes("user-leak@corp.sa")) fail(`raw email leaked in element: ${el}`);
  if (el.includes("4111111111111111")) fail(`raw PAN leaked in element: ${el}`);
  // F1 — bounded: id<=96, class<=96.
  const [, idPart, clsPart] = el.split("|");
  if ((idPart?.length ?? 0) > 96) fail(`id part not bounded: ${idPart?.length}`);
  if ((clsPart?.length ?? 0) > 96) fail(`class part not bounded: ${clsPart?.length}`);
  // F2 — control/bidi stripped (checked by codepoint).
  if (Array.from(el).some((ch) => isUnsafe(ch.codePointAt(0) ?? 0))) fail("control/bidi char survived");

  if (!failed) {
    console.log("PASS: element hardened ->", JSON.stringify(el));
    console.log(`  id len=${idPart?.length} class len=${clsPart?.length}`);
  }
  await sql.end();
  await ch.close();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  fail(e.message);
  process.exit(1);
});
