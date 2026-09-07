// Slice 9 Knowledge Hub e2e: a recurring unanswered question (no-result search
// seen >=3x) → AI draft → pending proposal → approve → published FAQ → the Agent
// now answers it grounded+cited. Plus dedup and tenancy. Mirrors the dashboard's
// generateProposals/approveProposalAction logic over the real stores.
// Run with tsx: node --import tsx bench/knowledge-check.mjs
import { draftArticle } from "@tracki/ai";
import { createClickHouse, faqReport, insertEvents } from "@tracki/clickhouse";
import postgres from "postgres";

const sql = postgres("postgres://tracki:tracki@localhost:5432/tracki");
const ch = createClickHouse();
let failed = 0;
let passed = 0;
const check = (name, cond) => {
  if (cond) passed++;
  else {
    failed++;
    console.error("  FAIL:", name);
  }
};

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
const qkey = (q) => norm(q);

async function mkProject(tag) {
  const key = `pk_${tag}${Math.random().toString(36).slice(2, 22)}`.slice(0, 27);
  const [org] = await sql`INSERT INTO organizations (name, slug) VALUES (${tag}, ${`${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`}) RETURNING id`;
  const [proj] = await sql`
    INSERT INTO projects (org_id, name, slug, public_key)
    VALUES (${org.id}, ${tag}, ${`${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`}, ${key}) RETURNING id`;
  return { orgId: org.id, projectId: proj.id, key };
}

const chat = (key, message, s) =>
  fetch("http://localhost:4000/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, anonId: `a_${s}`, sessionId: s, message }),
  }).then((r) => r.json());

// Replicates lib/knowledge.generateProposals for one project (>=3 threshold).
async function generate(p) {
  const report = await faqReport(ch, p.orgId, p.projectId, 30);
  const gaps = report.topNoResults
    .map((r) => ({ question: r.term, count: Number(r.count), source: "search" }))
    .filter((g) => g.count >= 3 && qkey(g.question));
  let created = 0;
  for (const g of gaps) {
    const draft = await draftArticle({ question: g.question });
    const res = await sql`
      INSERT INTO faq_proposals (project_id, question, question_key, source, occurrences, status, draft)
      VALUES (${p.projectId}, ${g.question}, ${qkey(g.question)}, ${g.source}, ${g.count}, 'pending', ${sql.json(draft)})
      ON CONFLICT (project_id, question_key) DO NOTHING
      RETURNING id`;
    if (res.length) created++;
  }
  return created;
}

async function main() {
  const now = Date.now();
  const p1 = await mkProject("kb1");
  const p2 = await mkProject("kb2");

  const GAP = "refund to oman";
  const ev = (project, q) => ({
    org_id: project.orgId,
    project_id: project.projectId,
    anon_id: "a",
    user_id: "",
    session_id: "s",
    event_id: `e-${Math.random().toString(36).slice(2)}`,
    type: "faq_search_noresult",
    path: "/",
    url: "",
    referrer: "",
    props: JSON.stringify({ query: q }),
    ua: "",
    ts: now,
    received_at: now,
  });
  // Recurring gap on p1 (4x ≥ threshold); a one-off on p2 (below threshold).
  await insertEvents(ch, [ev(p1, GAP), ev(p1, GAP), ev(p1, GAP), ev(p1, GAP), ev(p2, "gift wrap")]);

  // Baseline: before any article, the Agent escalates this question.
  const before = await chat(p1.key, GAP, "kb_b");
  check("baseline: unanswered question escalates", before.escalate === true && !before.citation);

  // Generate proposals (>=3x).
  const created = await generate(p1);
  check("a recurring gap creates a proposal", created >= 1);
  const props = await sql`
    SELECT id, status, draft FROM faq_proposals WHERE project_id = ${p1.projectId} AND status = 'pending'`;
  check("a pending proposal exists", props.length >= 1);
  const draft = props[0]?.draft;
  check(
    "draft has both languages",
    !!draft && !!(draft.titleAr && draft.bodyAr && draft.titleEn && draft.bodyEn),
  );

  // Dedup: re-generating must not duplicate.
  const created2 = await generate(p1);
  const keyRows = await sql`
    SELECT count(*)::int AS n FROM faq_proposals WHERE project_id = ${p1.projectId} AND question_key = ${qkey(GAP)}`;
  check("re-generation does not duplicate (dedup by key)", created2 === 0 && keyRows[0].n === 1);

  // Approve → a human edits the stub into a REAL bilingual answer, then publish.
  // (Audit 09 M1: approveProposalAction refuses to publish an un-edited stub.)
  const proposalId = props[0].id;
  const edited = {
    titleAr: "الاسترجاع إلى عُمان",
    bodyAr: "نعم، يمكنك طلب استرجاع للطلبات المشحونة إلى عُمان خلال ١٤ يوماً.",
    titleEn: "Refund to Oman",
    bodyEn: "Yes, you can request a refund for orders shipped to Oman within 14 days.",
  };
  const searchText = norm(`${edited.titleAr} ${edited.bodyAr} ${edited.titleEn} ${edited.bodyEn}`);
  const [art] = await sql`
    INSERT INTO faq_articles (project_id, slug, status, title_ar, body_ar, title_en, body_en, search_text)
    VALUES (${p1.projectId}, ${`kb-${Math.random().toString(36).slice(2, 8)}`}, 'published',
            ${edited.titleAr}, ${edited.bodyAr}, ${edited.titleEn}, ${edited.bodyEn}, ${searchText})
    RETURNING id`;
  await sql`UPDATE faq_proposals SET status = 'approved', article_id = ${art.id} WHERE id = ${proposalId}`;

  // Loop closed: the Agent now answers the same question grounded + cited with the
  // REAL answer — never the review placeholder.
  const after = await chat(p1.key, GAP, "kb_a");
  check(
    "after approval the Agent grounds + cites the new article",
    after.escalate === false && !!after.citation,
  );
  check(
    "the grounded reply is the real answer, not the review stub",
    typeof after.reply === "string" &&
      after.reply.length > 0 &&
      !after.reply.includes("pending human review"),
  );

  // Tenancy: the below-threshold p2 gap produced no proposal; p1's didn't leak.
  await generate(p2);
  const p2props = await sql`SELECT count(*)::int AS n FROM faq_proposals WHERE project_id = ${p2.projectId}`;
  check("tenancy + threshold: p2 (1x) has no proposals", p2props[0].n === 0);

  console.log(`\nKnowledge check: ${passed} passed, ${failed} failed`);
  await sql.end();
  await ch.close();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
