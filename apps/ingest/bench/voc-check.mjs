// Slice 8 VoC e2e: seeds chat (via /v1/chat, so masking is real), WhatsApp
// inbound, no-result FAQ searches and struggles for a project, then runs the
// same gather the dashboard's lib/voc.ts runs (project-scoped queries + the
// @tracki/ai clustering) and asserts: themes form, a known unanswered search
// surfaces as a gap, friction path present, PII masked at rest, tenancy holds.
// Run with tsx (imports workspace TS): node --import tsx bench/voc-check.mjs
import { clusterTopics, rankGaps } from "@tracki/ai";
import {
  createClickHouse,
  faqReport,
  insertEvents,
  insertStruggles,
  struggleCountsByPath,
} from "@tracki/clickhouse";
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

const chat = (key, message, sessionId) =>
  fetch("http://localhost:4000/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, anonId: `anon_${sessionId}`, sessionId, message }),
  }).then((r) => r.json());

async function mkProject(tag) {
  const key = `pk_${tag}${Math.random().toString(36).slice(2, 22)}`.slice(0, 27);
  const [org] = await sql`INSERT INTO organizations (name, slug) VALUES (${`${tag} Org`}, ${`${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`}) RETURNING id`;
  const [proj] = await sql`
    INSERT INTO projects (org_id, name, slug, public_key)
    VALUES (${org.id}, ${tag}, ${`${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`}, ${key}) RETURNING id`;
  return { orgId: org.id, projectId: proj.id, key };
}

async function seedFaq(projectId) {
  const seed = (cat, ta, ba, te, be) =>
    sql`INSERT INTO faq_articles (project_id, slug, status, title_ar, body_ar, title_en, body_en, search_text)
        VALUES (${projectId}, ${`${cat}-${Math.random().toString(36).slice(2, 8)}`}, 'published',
                ${ta}, ${ba}, ${te}, ${be}, ${norm(`${ta} ${ba} ${te} ${be}`)})`;
  await seed("pay", "كيفية الدفع", "ادفع بالبطاقة", "How to pay", "Pay by card on checkout payment");
  await seed("ship", "الشحن", "يصل خلال ٣ أيام", "Shipping", "Your order arrives in 3 days delivery");
}

async function main() {
  const now = Date.now();
  const p1 = await mkProject("v1");
  const p2 = await mkProject("v2");
  await seedFaq(p1.projectId);

  // --- Chat (real /v1/chat → masked persistence) ---
  // Answerable payment questions (cluster seed) + out-of-scope (escalations).
  await chat(p1.key, "how do I pay", "s1");
  await chat(p1.key, "payment by card on checkout", "s2");
  await chat(p1.key, "can I pay with my card", "s3");
  await chat(p1.key, "what is the weather today", "s4"); // out-of-scope → escalates
  await chat(p1.key, "tell me a joke please", "s5"); // out-of-scope → escalates
  const pii = await chat(p1.key, "pay using ahmad@test.sa", "s6");
  // Tenancy decoy in a different project.
  await chat(p2.key, "delivery tracking question shipping", "s7");

  // --- WhatsApp inbound (insert directly, masked content) ---
  const [waConv] = await sql`
    INSERT INTO wa_conversations (project_id, wa_id, language) VALUES (${p1.projectId}, '966500000000', 'ar') RETURNING id`;
  await sql`INSERT INTO wa_messages (conversation_id, direction, author, content, status)
            VALUES (${waConv.id}, 'inbound', 'customer', 'كيف ادفع بالبطاقة', 'sent')`;

  // --- No-result searches + struggles into ClickHouse ---
  const ev = (type, props) => ({
    org_id: p1.orgId,
    project_id: p1.projectId,
    anon_id: "anon_v",
    user_id: "",
    session_id: "sess_v",
    event_id: `ev-${Math.random().toString(36).slice(2)}`,
    type,
    path: "/checkout",
    url: "",
    referrer: "",
    props: JSON.stringify(props),
    ua: "",
    ts: now,
    received_at: now,
  });
  await insertEvents(ch, [
    ev("faq_search_noresult", { query: "refund to oman" }),
    ev("faq_search_noresult", { query: "refund to oman" }),
    ev("faq_search_noresult", { query: "gift wrapping" }),
    ev("faq_search", { query: "payment" }),
  ]);
  await insertStruggles(ch, [
    {
      org_id: p1.orgId,
      project_id: p1.projectId,
      struggle_id: `st-${Math.random().toString(36).slice(2)}`,
      type: "rage_click",
      severity: "high",
      path: "/checkout",
      reason: "3 rage clicks",
      anon_id: "anon_v",
      user_id: "",
      session_id: "sess_v",
      event_count: 3,
      ts: now,
    },
  ]);

  // ===== Replicate the dashboard gather (project-scoped) =====
  const chatDocs = await sql`
    SELECT m.id, m.content AS text FROM chat_messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.project_id = ${p1.projectId} AND m.role = 'user'`;
  const waDocs = await sql`
    SELECT m.id, m.content AS text FROM wa_messages m
    JOIN wa_conversations c ON c.id = m.conversation_id
    WHERE c.project_id = ${p1.projectId} AND m.direction = 'inbound' AND m.author = 'customer'`;
  const docs = [...chatDocs, ...waDocs].map((d) => ({ id: d.id, text: d.text }));

  const themes = await clusterTopics(docs);
  check("themes formed from customer messages", themes.length > 0);
  check("a 'pay'-ish theme dominates", themes.some((t) => /pay|ادفع|دفع/.test(t.label)));
  check("theme counts are grounded (≤ docs)", themes.every((t) => t.count >= 1 && t.count <= docs.length));

  // Gaps: ungrounded escalated questions + no-result searches.
  const escalated = await sql`
    SELECT m.content AS text FROM chat_messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.project_id = ${p1.projectId} AND c.escalated = 'true' AND m.role = 'user'`;
  const report = await faqReport(ch, p1.orgId, p1.projectId, 14);
  const noResults = report.topNoResults.map((r) => ({ term: r.term, count: Number(r.count) }));
  const gaps = rankGaps(noResults, escalated.map((r) => r.text));
  check("no-result search surfaces as a gap", gaps.some((g) => norm(g.question) === "refund to oman"));
  check("escalated question becomes a gap", gaps.some((g) => g.source === "escalation"));

  // Friction map.
  const friction = await struggleCountsByPath(ch, p1.orgId, p1.projectId, 14, 8);
  check("friction map includes /checkout", friction.some((f) => f.path === "/checkout"));

  // Self-resolution = derived deflection (Audit 08 M1): a grounded, non-escalated
  // conversation must move the rate off 0 (the status field is never auto-written).
  const [defl] = await sql`
    SELECT count(DISTINCT c.id)::int AS n
    FROM conversations c
    LEFT JOIN chat_messages m
      ON m.conversation_id = c.id AND m.role = 'assistant' AND m.citation_article_id IS NOT NULL
    WHERE c.project_id = ${p1.projectId}
      AND (c.status = 'self_resolved' OR (c.escalated = 'false' AND m.id IS NOT NULL))`;
  check("self-resolution counts grounded deflections (not the unwritten status)", defl.n >= 1);

  // PII masked at rest (the email message went through /v1/chat).
  const piiRows = await sql`
    SELECT content FROM chat_messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.project_id = ${p1.projectId} AND m.role = 'user' AND m.content LIKE '%@%'`;
  check("chat PII masked at rest", piiRows.length > 0 && piiRows.every((r) => !r.content.includes("ahmad@test.sa")));
  check("chat created a conversation", !!pii.conversationId);

  // Tenancy: project 2's decoy never appears in project 1's corpus.
  check("tenancy: no cross-project message bleed", !docs.some((d) => /delivery tracking/.test(d.text)));

  console.log(
    `\nVoC check: ${passed} passed, ${failed} failed | docs=${docs.length} themes=${themes.length} gaps=${gaps.length} friction=${friction.length}`,
  );
  await sql.end();
  await ch.close();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
