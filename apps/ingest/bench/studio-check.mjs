// Slice 12 Action Studio e2e over the real stack:
//   1) frictionSeeds (CH) reads seeded struggles → path + dominant type/element + summed friction
//   2) Autopilot offline pipeline: seeds → deterministic playbook draft → schema-valid action
//      (mirrors lib/action-studio.generateActionProposals incl. seed dedup)
//   3) the manifest passes channel CTAs (cta.kind) through to the snippet
//   4) /v1/handoff mints an inquiry code + wa.me deep link (the WhatsApp CTA flow)
//   5) action_click events carry `channel` through the real ingest pipeline → actionChannelClicks
//   6) actionOutcomes recovery logic: struggled-before sessions, recovered vs not, goal override
// Run with tsx: node --import tsx bench/studio-check.mjs
import { draftActionFromSeed, proposeSeeds } from "@tracki/ai";
import {
  actionChannelClicks,
  actionOutcomes,
  createClickHouse,
  frictionSeeds,
  insertEvents,
  insertStruggles,
} from "@tracki/clickhouse";
import { actionDefinitionSchema } from "@tracki/shared";
import postgres from "postgres";

const sql = postgres("postgres://tracki:tracki@localhost:5432/tracki");
const ch = createClickHouse();
let failed = 0;
let passed = 0;
const check = (name, cond, extra = "") => {
  if (cond) {
    passed++;
    console.log("  ok:", name);
  } else {
    failed++;
    console.error("  FAIL:", name, extra);
  }
};

async function mkProject(tag) {
  const key = `pk_${tag}${Math.random().toString(36).slice(2, 22)}`.slice(0, 27);
  const [org] =
    await sql`INSERT INTO organizations (name, slug) VALUES (${tag}, ${`${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`}) RETURNING id`;
  const [proj] = await sql`
    INSERT INTO projects (org_id, name, slug, public_key)
    VALUES (${org.id}, ${tag}, ${`${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`}, ${key}) RETURNING id`;
  return { orgId: org.id, projectId: proj.id, key };
}

const struggle = (p, session, path, type, score, element, ts) => ({
  org_id: p.orgId,
  project_id: p.projectId,
  anon_id: `a_${session}`,
  user_id: "",
  session_id: session,
  struggle_id: `st_${Math.random().toString(36).slice(2, 10)}`,
  type,
  severity: "high",
  path,
  element,
  reason: "bench",
  event_count: 3,
  score,
  ts,
});

const event = (p, session, type, props, ts) => ({
  org_id: p.orgId,
  project_id: p.projectId,
  anon_id: `a_${session}`,
  user_id: "",
  session_id: session,
  event_id: `ev_${Math.random().toString(36).slice(2, 12)}`,
  type,
  path: "/checkout",
  url: "https://shop.sa/checkout",
  referrer: "",
  props: JSON.stringify(props),
  ua: "bench",
  ts,
  received_at: ts,
});

async function main() {
  const now = Date.now();

  // ---------- 1) frictionSeeds over seeded struggles ----------
  const p1 = await mkProject("studio");
  await insertStruggles(ch, [
    struggle(p1, "s1", "/checkout", "rage_click", 88, "button#pay|pay|btn", now - 60_000),
    struggle(p1, "s2", "/checkout", "rage_click", 80, "button#pay|pay|btn", now - 50_000),
    struggle(p1, "s3", "/checkout", "dead_click", 40, "", now - 40_000),
    struggle(p1, "s4", "/help", "thrashing", 25, "", now - 30_000),
  ]);
  const seeds = await frictionSeeds(ch, p1.orgId, p1.projectId, 30, 12);
  const checkout = seeds.find((r) => r.path === "/checkout");
  check("frictionSeeds ranks /checkout first by summed friction", seeds[0]?.path === "/checkout");
  check(
    "frictionSeeds: dominant type + element + count + friction",
    checkout &&
      checkout.top_type === "rage_click" &&
      checkout.top_element === "button#pay|pay|btn" &&
      checkout.count === "3" &&
      checkout.friction === "208",
    JSON.stringify(checkout),
  );

  // ---------- 2) Autopilot offline pipeline (mirrors generateActionProposals) ----------
  const friction = seeds.map((r) => ({
    path: r.path,
    struggleType: r.top_type,
    count: Number(r.count),
    score: Number(r.friction),
    element: r.top_element || undefined,
  }));
  const proposed = proposeSeeds(friction, [{ question: "how do I pay at checkout", count: 4 }]);
  check("proposeSeeds emits a /checkout seed with gap evidence", proposed[0]?.evidence.path === "/checkout" && !!proposed[0]?.evidence.gapQuestion);
  const { draft, evidence } = await draftActionFromSeed(proposed[0]);
  check("offline draft parses actionDefinitionSchema", actionDefinitionSchema.safeParse(draft.definition).success);
  check(
    "offline draft: bilingual copy, whatsapp channel (high friction, high intent), purchase goal",
    draft.definition.content.ar.title.length > 0 &&
      draft.definition.content.en.title.length > 0 &&
      draft.definition.content.ar.cta?.kind === "whatsapp" &&
      draft.definition.goalEvent === "purchase",
    JSON.stringify({ cta: draft.definition.content.ar.cta, goal: draft.definition.goalEvent }),
  );
  check("evidence carries real numbers from CH", evidence.count === 3 && evidence.score === 208);
  // Dedup mirror: a second run over the same seeds creates nothing new.
  const seenKeys = new Set(proposed.map((s) => s.seedKey));
  const rerun = proposeSeeds(friction).filter((s) => !seenKeys.has(s.seedKey));
  check("regeneration over the same friction adds no new seeds", rerun.length === 0);

  // ---------- 3) manifest passes channel CTAs through ----------
  const def = {
    type: "popup",
    content: {
      ar: { title: "مساعدة", body: "هل تحتاج مساعدة؟", cta: { label: "واتساب", kind: "whatsapp" } },
      en: { title: "Help", body: "Need help?", cta: { label: "WhatsApp", kind: "whatsapp" } },
    },
    trigger: { kind: "rage_click" },
    urlContains: "/checkout",
    goalEvent: "purchase",
  };
  const [act] = await sql`
    INSERT INTO actions (project_id, name, type, status, definition)
    VALUES (${p1.projectId}, 'WA rescue', 'popup', 'live', ${sql.json(def)}) RETURNING id`;
  const manifest = await fetch(`http://localhost:4000/v1/actions?key=${p1.key}`).then((r) => r.json());
  const entry = (manifest.actions ?? []).find((a) => a.id === act.id);
  check("manifest serves the whatsapp cta.kind", entry?.content?.ar?.cta?.kind === "whatsapp", JSON.stringify(entry?.content?.ar?.cta));

  // ---------- 4) WhatsApp CTA handoff ----------
  const handoff = await fetch("http://localhost:4000/v1/handoff", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: p1.key, anonId: "a_s1", sessionId: "s1", path: "/checkout", locale: "ar" }),
  }).then((r) => r.json());
  check(
    "handoff mints inquiry code + wa.me deep link",
    /^TR-/.test(handoff.inquiryCode ?? "") && /^https:\/\/wa\.me\//.test(handoff.deepLink ?? ""),
    JSON.stringify(handoff),
  );

  // ---------- 5) channel survives the real ingest pipeline ----------
  await fetch("http://localhost:4000/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key: p1.key,
      anonId: "a_s1",
      sessionId: "s1",
      sentAt: Date.now(),
      events: [
        { type: "action_click", ts: Date.now(), path: "/checkout", url: "https://shop.sa/checkout", props: { action_id: act.id, variant: "A", channel: "whatsapp" } },
        { type: "action_click", ts: Date.now(), path: "/checkout", url: "https://shop.sa/checkout", props: { action_id: act.id, variant: "A", channel: "chat" } },
      ],
    }),
  });
  await new Promise((r) => setTimeout(r, 2500));
  const channels = await actionChannelClicks(ch, p1.orgId, p1.projectId, 30);
  const wa = channels.find((c) => c.action_id === act.id && c.channel === "whatsapp");
  const chat = channels.find((c) => c.action_id === act.id && c.channel === "chat");
  check("actionChannelClicks splits clicks by channel", wa?.clicks === "1" && chat?.clicks === "1", JSON.stringify(channels));

  // ---------- 6) actionOutcomes recovery logic (controlled timestamps) ----------
  const p2 = await mkProject("outc");
  const actId = "act_outcomes_1";
  const t0 = now - 600_000;
  await insertStruggles(ch, [
    // r1: struggle BEFORE impression, none after → recovered
    struggle(p2, "r1", "/checkout", "rage_click", 50, "", t0),
    // r2: struggle before AND after, no goal → NOT recovered
    struggle(p2, "r2", "/checkout", "rage_click", 50, "", t0),
    struggle(p2, "r2", "/checkout", "rage_click", 55, "", t0 + 120_000),
    // r3: struggle before AND after, but goal fired → recovered (goal overrides)
    struggle(p2, "r3", "/checkout", "rage_click", 50, "", t0),
    struggle(p2, "r3", "/checkout", "rage_click", 55, "", t0 + 120_000),
    // r4: struggle only AFTER the impression → excluded from "struggled before"
    struggle(p2, "r4", "/checkout", "rage_click", 50, "", t0 + 120_000),
  ]);
  await insertEvents(ch, [
    event(p2, "r1", "action_impression", { action_id: actId, variant: "A" }, t0 + 60_000),
    event(p2, "r2", "action_impression", { action_id: actId, variant: "A" }, t0 + 60_000),
    event(p2, "r3", "action_impression", { action_id: actId, variant: "A" }, t0 + 60_000),
    event(p2, "r4", "action_impression", { action_id: actId, variant: "A" }, t0 + 60_000),
    event(p2, "r3", "action_goal", { action_id: actId, variant: "A" }, t0 + 180_000),
  ]);
  const outcomes = await actionOutcomes(ch, p2.orgId, p2.projectId, 30);
  const o = outcomes.find((r) => r.action_id === actId);
  check(
    "actionOutcomes: 3 struggled-before sessions, 2 recovered (clean + goal-override)",
    o?.struggled_sessions === "3" && o?.recovered_sessions === "2",
    JSON.stringify(outcomes),
  );

  // ---------- tenancy: project A's studio data never leaks into B ----------
  const cross = await actionOutcomes(ch, p1.orgId, p1.projectId, 30);
  check("outcomes are project-scoped (no cross-project rows)", !cross.some((r) => r.action_id === actId));

  console.log(failed === 0 ? `PASS ${passed}/${passed + failed}` : `FAILED ${failed}/${passed + failed}`);
  await sql.end();
  await ch.close();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
