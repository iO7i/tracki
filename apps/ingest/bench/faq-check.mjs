// Integration check for implementation: seeds bilingual articles (one draft), verifies
// the /v1/faq endpoint serves published-only with Arabic-aware search (diacritic
// + teh-marbuta variant matches), and that faq_* events land in ClickHouse.
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

// Mirror of shared normalizeText (kept tiny here for the seed search_text).
function norm(s) {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\p{M}/gu, "")
    .replace(/ـ/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const key = `pk_fq${Math.random().toString(36).slice(2, 22)}`.slice(0, 27);
  const [org] = await sql`
    INSERT INTO organizations (name, slug) VALUES ('FQ Org', ${`fq-${Date.now()}`}) RETURNING id`;
  const [proj] = await sql`
    INSERT INTO projects (org_id, name, slug, public_key)
    VALUES (${org.id}, 'FQ', ${`fq-${Date.now()}`}, ${key}) RETURNING id`;

  // Published article titled with teh-marbuta + diacritics; search with a variant.
  const titleAr = "الخِدْمَة السريعة";
  const search = norm(`${titleAr} كيفية الاشتراك service fast`);
  await sql`
    INSERT INTO faq_articles (project_id, slug, status, title_ar, body_ar, title_en, body_en, search_text)
    VALUES (${proj.id}, ${`a-${Date.now()}`}, 'published', ${titleAr}, 'محتوى', 'Fast service', 'content', ${search})`;
  // A draft that must NOT be served.
  await sql`
    INSERT INTO faq_articles (project_id, slug, status, title_ar, body_ar, title_en, body_en, search_text)
    VALUES (${proj.id}, ${`d-${Date.now()}`}, 'draft', 'مسودة', '', 'Draft', '', ${norm("مسوده draft")})`;

  // 1) Arabic-variant search ("خدمه" — no diacritics, teh→heh) finds the article.
  const r1 = await (await fetch(`http://localhost:4000/v1/faq?key=${key}&q=${encodeURIComponent("خدمه")}`)).json();
  if ((r1.articles ?? []).length !== 1) fail(`Arabic-variant search should find 1, got ${r1.articles?.length}`);

  // 2) English search works.
  const r2 = await (await fetch(`http://localhost:4000/v1/faq?key=${key}&q=service`)).json();
  if ((r2.articles ?? []).length !== 1) fail(`English search should find 1, got ${r2.articles?.length}`);

  // 3) No query → published only (draft excluded).
  const r3 = await (await fetch(`http://localhost:4000/v1/faq?key=${key}`)).json();
  if ((r3.articles ?? []).length !== 1) fail(`list should return 1 published, got ${r3.articles?.length}`);

  // 4) Unknown key → empty.
  const r4 = await (await fetch("http://localhost:4000/v1/faq?key=pk_nope_nope_nope_nope_nope")).json();
  if ((r4.articles ?? []).length !== 0) fail("unknown key returned articles");

  // 5) faq_* events flow through to ClickHouse (with PII scrub on query).
  await fetch("http://localhost:4000/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key,
      anonId: "anon_help",
      sessionId: "s_help",
      sentAt: Date.now(),
      events: [
        { type: "faq_search", ts: Date.now(), path: "/help", props: { query: "خدمه my email a@b.sa" } },
        { type: "faq_view", ts: Date.now(), path: "/help", props: { article_id: "x" } },
        { type: "faq_vote_up", ts: Date.now(), path: "/help", props: { article_id: "x" } },
      ],
    }),
  });
  await new Promise((r) => setTimeout(r, 2500));
  const rs = await ch.query({
    query: `SELECT type, JSONExtractString(props,'query') AS q FROM events
            WHERE project_id={p:String} AND type LIKE 'faq_%'`,
    query_params: { p: proj.id },
    format: "JSONEachRow",
  });
  const rows = await rs.json();
  const types = new Set(rows.map((r) => r.type));
  if (!types.has("faq_search") || !types.has("faq_view") || !types.has("faq_vote_up")) {
    fail(`missing faq events: ${[...types].join(",")}`);
  }
  const searchRow = rows.find((r) => r.type === "faq_search");
  if (searchRow && searchRow.q.includes("a@b.sa")) fail("raw email not scrubbed in faq_search query");

  if (!failed) {
    console.log("PASS: Arabic-variant + English search; published-only; unknown key empty;");
    console.log("  faq events stored:", [...types].join(", "), "| scrubbed query:", searchRow?.q);
  }
  await sql.end();
  await ch.close();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  fail(e.message);
  process.exit(1);
});
