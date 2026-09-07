import { generatePublicKey, normalizeText } from "@tracki/shared";
/**
 * Seed the Vertex production dogfooding tenant.
 *
 *   DATABASE_URL=postgres://... \
 *   [VERTEX_PUBLIC_KEY=pk_...] [SEED_OWNER_PASSWORD=...] \
 *   pnpm --filter @tracki/dashboard exec tsx scripts/seed-vertex.ts
 *
 * Idempotent: safe to re-run. Creates org "Vertex", an owner user, a project for
 * tryvertex.io (with Vertex's conversion config), two published help articles,
 * and the restrained action set (one live struggle→FAQ helper, one draft
 * "book profit analysis" CTA). Prints the public key to embed in the snippet.
 *
 * NOTE: does NOT import "@/db" (that module is server-only). Builds its own
 * postgres-js client from DATABASE_URL.
 */
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const sql = postgres(url);
const db = drizzle(sql, { schema });

const OWNER_EMAIL = "admin@tryvertex.io";
const ORG_SLUG = "vertex";
const PROJECT_SLUG = "marketing";

async function main() {
  // 1) owner user ------------------------------------------------------------
  let [user] = await db.select().from(schema.users).where(eq(schema.users.email, OWNER_EMAIL));
  if (!user) {
    const passwordHash = await bcrypt.hash(process.env.SEED_OWNER_PASSWORD ?? "change-me-now", 12);
    [user] = await db
      .insert(schema.users)
      .values({ email: OWNER_EMAIL, name: "Vertex Owner", passwordHash })
      .returning();
  }
  if (!user) throw new Error("failed to create owner user");

  // 2) organization ----------------------------------------------------------
  let [org] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, ORG_SLUG));
  if (!org) {
    [org] = await db
      .insert(schema.organizations)
      .values({ name: "Vertex", slug: ORG_SLUG })
      .returning();
  }
  if (!org) throw new Error("failed to create org");

  // 3) membership (owner) ----------------------------------------------------
  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, org.id), eq(schema.memberships.userId, user.id)));
  if (!membership) {
    await db.insert(schema.memberships).values({ orgId: org.id, userId: user.id, role: "owner" });
  }

  // 4) project (tryvertex.io marketing) --------------------------------------
  let [project] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.orgId, org.id), eq(schema.projects.slug, PROJECT_SLUG)));
  if (!project) {
    [project] = await db
      .insert(schema.projects)
      .values({
        orgId: org.id,
        name: "tryvertex.io",
        slug: PROJECT_SLUG,
        publicKey: process.env.VERTEX_PUBLIC_KEY ?? generatePublicKey(),
        siteUrl: "https://tryvertex.io",
        currency: "SAR",
        // Vertex's paid conversion is a subscription; AOV set by the operator later.
        conversionEvent: "subscription_started",
        avgOrderValue: 0,
      })
      .returning();
  }
  if (!project) throw new Error("failed to create project");

  // 5) help articles (published — grounds the FAQ/help widget) ---------------
  const articles = [
    {
      slug: "connect-store",
      titleAr: "كيف أربط متجر زد أو سلة؟",
      bodyAr:
        "من لوحة Vertex اختر منصتك (زد أو سلة)، ثم اضغط ربط المتجر وأكمل تسجيل الدخول الآمن. تُنجَز المزامنة الأولى تلقائياً بعد الربط.",
      titleEn: "How do I connect my Zid or Salla store?",
      bodyEn:
        "In the Vertex dashboard choose your platform (Zid or Salla), click Connect store, and complete the secure sign-in. The first sync runs automatically after connection.",
    },
    {
      slug: "book-profit-analysis",
      titleAr: "ما هو تحليل الأرباح المجاني؟",
      bodyAr:
        "تحليل الأرباح المجاني جلسة قصيرة نوضح فيها صافي أرباحك الحقيقية بعد الرسوم والتكاليف. احجز موعدك من صفحة الحجز.",
      titleEn: "What is the free profit analysis?",
      bodyEn:
        "The free profit analysis is a short session where we show your real net profit after fees and costs. Book a slot from the booking page.",
    },
  ];
  for (const a of articles) {
    const [exists] = await db
      .select()
      .from(schema.faqArticles)
      .where(
        and(eq(schema.faqArticles.projectId, project.id), eq(schema.faqArticles.slug, a.slug)),
      );
    if (exists) continue;
    await db.insert(schema.faqArticles).values({
      projectId: project.id,
      slug: a.slug,
      status: "published",
      titleAr: a.titleAr,
      bodyAr: a.bodyAr,
      titleEn: a.titleEn,
      bodyEn: a.bodyEn,
      searchText: normalizeText(`${a.titleAr} ${a.bodyAr} ${a.titleEn} ${a.bodyEn}`),
    });
  }

  // 6) restrained actions ----------------------------------------------------
  const struggleHelp = {
    name: "Struggle help (web)",
    type: "banner",
    status: "live" as const,
    definition: {
      type: "banner",
      surface: "web",
      trigger: { kind: "struggle" },
      struggleTypes: [
        "repeated_error",
        "repeated_submit",
        "form_abandon",
        "dead_click",
        "rage_click",
      ],
      frequencyCap: 3,
      content: {
        ar: {
          title: "هل تحتاج مساعدة؟",
          body: "يبدو أنك واجهت صعوبة. تصفّح المساعدة السريعة لحل المشكلة.",
          cta: { label: "افتح المساعدة", kind: "faq" },
        },
        en: {
          title: "Need a hand?",
          body: "Looks like something got stuck. Open quick help to resolve it.",
          cta: { label: "Open help", kind: "faq" },
        },
      },
    },
  };
  const profitCta = {
    name: "Book free profit analysis",
    type: "banner",
    status: "draft" as const,
    definition: {
      type: "banner",
      surface: "web",
      trigger: { kind: "exit_intent" },
      urlContains: "pricing",
      frequencyCap: 1,
      content: {
        ar: {
          title: "احجز تحليل أرباحك المجاني",
          body: "قبل أن تغادر — اكتشف صافي أرباحك الحقيقية في جلسة قصيرة مجانية.",
          cta: { label: "احجز الآن", kind: "url", url: "https://tryvertex.io/demo" },
        },
        en: {
          title: "Book your free profit analysis",
          body: "Before you go — see your real net profit in a short free session.",
          cta: { label: "Book now", kind: "url", url: "https://tryvertex.io/demo" },
        },
      },
    },
  };
  for (const act of [struggleHelp, profitCta]) {
    const [exists] = await db
      .select()
      .from(schema.actions)
      .where(and(eq(schema.actions.projectId, project.id), eq(schema.actions.name, act.name)));
    if (exists) continue;
    await db.insert(schema.actions).values({
      projectId: project.id,
      name: act.name,
      type: act.type,
      status: act.status,
      definition: act.definition,
    });
  }

  console.log("Vertex tenant seeded:");
  console.log(`  org:        ${org.slug} (${org.id})`);
  console.log(`  owner:      ${OWNER_EMAIL}`);
  console.log(`  project:    ${project.slug} (${project.id})`);
  console.log(`  PUBLIC KEY: ${project.publicKey}   <-- embed in the snippet data-key`);
  console.log("  actions:    'Struggle help (web)' LIVE, 'Book free profit analysis' DRAFT");
  console.log("  articles:   connect-store, book-profit-analysis (published)");
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
