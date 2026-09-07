// Integration check for slice 5: a server-detected struggle (form_abandon —
// NOT client rage) arms a Live Assist returned on the next event flush, with a
// grounded matched FAQ; a context with no matching FAQ falls back; struggle
// actions are excluded from the client manifest.
import postgres from "postgres";

const sql = postgres("postgres://tracki:tracki@localhost:5432/tracki");
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
  }).then((r) => r.json());

function norm(s) {
  return s.toLowerCase().normalize("NFKC").replace(/\p{M}/gu, "").replace(/ـ/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
}

async function main() {
  const key = `pk_as${Math.random().toString(36).slice(2, 22)}`.slice(0, 27);
  const [org] = await sql`INSERT INTO organizations (name, slug) VALUES ('AS Org', ${`as-${Date.now()}`}) RETURNING id`;
  const [proj] = await sql`
    INSERT INTO projects (org_id, name, slug, public_key)
    VALUES (${org.id}, 'AS', ${`as-${Date.now()}`}, ${key}) RETURNING id`;

  // A checkout/payment FAQ (published) — the grounded answer.
  await sql`
    INSERT INTO faq_articles (project_id, slug, status, title_ar, body_ar, title_en, body_en, search_text)
    VALUES (${proj.id}, ${`pay-${Date.now()}`}, 'published', 'الدفع', 'خطوات الدفع', 'Payment', 'How to pay at checkout',
            ${norm("الدفع خطوات الدفع payment checkout how to pay")})`;

  // Live Assist action: struggle trigger, form_abandon, /checkout.
  const assistDef = {
    type: "popup",
    content: { ar: { title: "بحاجة لمساعدة؟", body: "" , cta: { label: "تحدّث إلينا", url: "https://x.sa/chat" } },
               en: { title: "Need help?", body: "", cta: { label: "Talk to us", url: "https://x.sa/chat" } } },
    trigger: { kind: "struggle" },
    struggleTypes: ["form_abandon"],
    urlContains: "/checkout",
  };
  await sql`INSERT INTO actions (project_id, name, type, status, definition)
    VALUES (${proj.id}, 'Checkout assist', 'popup', 'live', ${sql.json(assistDef)})`;

  // A second Live Assist for /widgets where NO FAQ exists → fallback path.
  const fbDef = { ...assistDef, urlContains: "/widgets" };
  await sql`INSERT INTO actions (project_id, name, type, status, definition)
    VALUES (${proj.id}, 'Widgets assist', 'popup', 'live', ${sql.json(fbDef)})`;

  // 1) Manifest must EXCLUDE struggle-trigger actions.
  const manifest = await (await fetch(`http://localhost:4000/v1/actions?key=${key}`)).json();
  if ((manifest.actions ?? []).length !== 0) fail(`manifest leaked struggle actions: ${manifest.actions?.length}`);

  // 2) S3 answer: form_abandon on /checkout → assist on next flush (answer mode).
  const sA = "sess_assist_a";
  await post({ key, anonId: "anon_a", sessionId: sA, sentAt: Date.now(),
    events: [{ type: "form_abandon", ts: Date.now(), path: "/checkout", url: "https://shop.sa/checkout", props: { tag: "form" } }] });
  await new Promise((r) => setTimeout(r, 3500));
  const resp = await post({ key, anonId: "anon_a", sessionId: sA, sentAt: Date.now(),
    events: [{ type: "pageview", ts: Date.now(), path: "/checkout", url: "https://shop.sa/checkout" }] });
  if (!resp.assist) fail("no assist returned for server-detected form_abandon struggle (S3)");
  else {
    if (resp.assist.mode !== "answer") fail(`expected answer mode, got ${resp.assist.mode}`);
    if (!resp.assist.article?.en?.title?.includes("Payment")) fail(`wrong matched article: ${JSON.stringify(resp.assist.article?.en)}`);
  }

  // 3) Grounding fallback: form_abandon on /widgets → assist fallback (no FAQ).
  const sB = "sess_assist_b";
  await post({ key, anonId: "anon_b", sessionId: sB, sentAt: Date.now(),
    events: [{ type: "form_abandon", ts: Date.now(), path: "/widgets", url: "https://shop.sa/widgets", props: { tag: "form" } }] });
  await new Promise((r) => setTimeout(r, 3500));
  const resp2 = await post({ key, anonId: "anon_b", sessionId: sB, sentAt: Date.now(),
    events: [{ type: "pageview", ts: Date.now(), path: "/widgets", url: "https://shop.sa/widgets" }] });
  if (!resp2.assist) fail("no assist for /widgets struggle");
  else if (resp2.assist.mode !== "fallback") fail(`expected fallback (no FAQ), got ${resp2.assist.mode}`);

  if (!failed) {
    console.log("PASS: struggle actions excluded from manifest;");
    console.log("  S3 server form_abandon -> answer assist, matched:", resp.assist?.article?.en?.title);
    console.log("  grounding fallback on /widgets ->", resp2.assist?.mode);
  }
  await sql.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { fail(e.message); process.exit(1); });
