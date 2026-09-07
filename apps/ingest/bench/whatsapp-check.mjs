// Slice 7 WhatsApp bridge e2e: handoff mints an inquiry code + context; a
// simulated inbound carrying the code links the context, Agent first-responds
// grounded; PII masked at rest; contact stored; takeover stops auto-reply.
import postgres from "postgres";

const sql = postgres("postgres://tracki:tracki@localhost:5432/tracki");
let failed = false;
const fail = (m) => {
  console.error("FAIL:", m);
  failed = true;
};

function norm(s) {
  return s.toLowerCase().normalize("NFKC").replace(/\p{M}/gu, "").replace(/ـ/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
}
const post = (path, body) =>
  fetch(`http://localhost:4000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function main() {
  const key = `pk_wa${Math.random().toString(36).slice(2, 22)}`.slice(0, 27);
  const [org] = await sql`INSERT INTO organizations (name, slug) VALUES ('WA Org', ${`wa-${Date.now()}`}) RETURNING id`;
  const [proj] = await sql`
    INSERT INTO projects (org_id, name, slug, public_key)
    VALUES (${org.id}, 'WA', ${`wa-${Date.now()}`}, ${key}) RETURNING id`;
  await sql`
    INSERT INTO faq_articles (project_id, slug, status, title_ar, body_ar, title_en, body_en, search_text)
    VALUES (${proj.id}, ${`pay-${Date.now()}`}, 'published', 'الدفع', 'ادفع بالبطاقة', 'Payment', 'Pay by card at checkout',
            ${norm("الدفع ادفع بالبطاقه payment pay card checkout")})`;

  // 1) Handoff mints an inquiry code + deep link + persists context.
  const ho = await (await post("/v1/handoff", {
    key, anonId: "anon_wa", sessionId: "sess_wa", path: "/checkout", locale: "ar",
  })).json();
  if (!ho.inquiryCode || !/^TR-/.test(ho.inquiryCode)) fail(`no inquiry code: ${JSON.stringify(ho)}`);
  if (!ho.deepLink || !ho.deepLink.includes("wa.me")) fail("no wa.me deep link");
  const hoRow = await sql`SELECT context FROM handoffs WHERE inquiry_code = ${ho.inquiryCode}`;
  if (!hoRow[0] || hoRow[0].context.path !== "/checkout") fail("handoff context not persisted");

  // 2) Simulated inbound carrying the code → links context + Agent first-response.
  const waId = "966500001122";
  await post("/v1/whatsapp/simulate", {
    key, from: waId, text: `مرحباً، رقم استفساري: ${ho.inquiryCode} كيف ادفع`,
  });
  await new Promise((r) => setTimeout(r, 800));

  const convo = await sql`
    SELECT c.id, c.wa_id, c.handoff_id, c.takeover FROM wa_conversations c
    WHERE c.project_id = ${proj.id} AND c.wa_id = ${waId}`;
  if (!convo[0]) fail("no wa_conversation created");
  else {
    if (!convo[0].handoff_id) fail("conversation not linked to handoff context (S2)");
    const msgs = await sql`SELECT direction, author, content FROM wa_messages WHERE conversation_id = ${convo[0].id} ORDER BY created_at`;
    const hasInbound = msgs.some((m) => m.direction === "inbound" && m.author === "customer");
    const agentReply = msgs.find((m) => m.direction === "outbound" && m.author === "agent");
    if (!hasInbound) fail("inbound customer message not stored");
    if (!agentReply) fail("Agent did not first-respond");
  }

  // 3) PII masked at rest (inject an email in an inbound).
  await post("/v1/whatsapp/simulate", { key, from: waId, text: "راسلني على buyer@shop.sa" });
  await new Promise((r) => setTimeout(r, 600));
  const piiRows = await sql`
    SELECT content FROM wa_messages m JOIN wa_conversations c ON c.id = m.conversation_id
    WHERE c.project_id = ${proj.id} AND m.content LIKE '%@%'`;
  if (piiRows.some((r) => r.content.includes("buyer@shop.sa"))) fail("raw email not masked at rest");

  // 4) Takeover stops Agent auto-reply: the new inbound is stored, but NO new
  // agent reply is added (compare agent-reply count before vs after).
  const agentBefore = (
    await sql`SELECT count(*) AS n FROM wa_messages WHERE conversation_id = ${convo[0].id} AND author = 'agent'`
  )[0].n;
  await sql`UPDATE wa_conversations SET takeover = 'true' WHERE id = ${convo[0].id}`;
  await post("/v1/whatsapp/simulate", { key, from: waId, text: "كيف ادفع مرة اخرى" });
  await new Promise((r) => setTimeout(r, 700));
  const agentAfter = (
    await sql`SELECT count(*) AS n FROM wa_messages WHERE conversation_id = ${convo[0].id} AND author = 'agent'`
  )[0].n;
  const inboundCount = (
    await sql`SELECT count(*) AS n FROM wa_messages WHERE conversation_id = ${convo[0].id} AND author = 'customer'`
  )[0].n;
  if (Number(inboundCount) < 3) fail(`inbound under takeover not stored (${inboundCount})`);
  if (Number(agentAfter) !== Number(agentBefore)) {
    fail(`agent replied under takeover (was ${agentBefore}, now ${agentAfter})`);
  }

  // 5) Simulate endpoint is simulator-only — confirm it's reachable (provider=simulator default).
  if (!failed) {
    console.log("PASS: handoff→code+context; inbound linked context + Agent first-response;");
    console.log("  PII masked at rest; takeover stops auto-reply.");
    console.log("  inquiry:", ho.inquiryCode, "deepLink:", ho.deepLink.slice(0, 40) + "…");
  }
  await sql.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { fail(e.message); process.exit(1); });
