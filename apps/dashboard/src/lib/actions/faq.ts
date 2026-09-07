"use server";

import { db } from "@/db";
import { faqArticles } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { requireMembership, requireProject } from "@/lib/tenancy";
import {
  type CreateFaqInput,
  MANAGER_ROLES,
  createFaqSchema,
  normalizeText,
  randomToken,
  slugify,
} from "@tracki/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CSV_ROWS = 500;

function localeFrom(formData: FormData): string {
  return formData.get("locale") === "en" ? "en" : "ar";
}

function buildSearchText(input: CreateFaqInput): string {
  return normalizeText(
    [input.ar.title, input.ar.body, input.en.title, input.en.body, input.tags.join(" ")].join(" "),
  );
}

function rowValues(projectId: string, input: CreateFaqInput) {
  const base = slugify(input.en.title || input.ar.title || "faq");
  return {
    projectId,
    slug: `${base}-${randomToken(6).toLowerCase()}`,
    category: input.category ?? "",
    tags: input.tags,
    status: input.status,
    titleAr: input.ar.title,
    bodyAr: input.ar.body,
    titleEn: input.en.title,
    bodyEn: input.en.body,
    searchText: buildSearchText(input),
  };
}

export async function createFaqAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);

  const parsed = createFaqSchema.safeParse({
    category: formData.get("category"),
    tags: String(formData.get("tags") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    status: formData.get("status"),
    ar: { title: formData.get("titleAr"), body: formData.get("bodyAr") },
    en: { title: formData.get("titleEn"), body: formData.get("bodyEn") },
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "errors.generic" };

  await db.insert(faqArticles).values(rowValues(ctx.project.id, parsed.data));
  revalidatePath(`/${locale}/orgs/${orgSlug}/faq`);
  return undefined;
}

/** Bulk import: category,title_ar,body_ar,title_en,body_en,tags (one per line). */
export async function importFaqCsvAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);

  const csv = String(formData.get("csv") ?? "").trim();
  if (!csv) return { error: "errors.required" };
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length > MAX_CSV_ROWS) return { error: "errors.tooLong" };

  const rows: ReturnType<typeof rowValues>[] = [];
  for (const line of lines) {
    const cols = parseCsvLine(line);
    const parsed = createFaqSchema.safeParse({
      category: cols[0] ?? "",
      tags: (cols[5] ?? "")
        .split(/[;|]/)
        .map((s) => s.trim())
        .filter(Boolean),
      status: "published",
      ar: { title: cols[1] ?? "", body: cols[2] ?? "" },
      en: { title: cols[3] ?? "", body: cols[4] ?? "" },
    });
    if (parsed.success) rows.push(rowValues(ctx.project.id, parsed.data));
  }
  if (rows.length === 0) return { error: "errors.generic" };
  await db.insert(faqArticles).values(rows);
  revalidatePath(`/${locale}/orgs/${orgSlug}/faq`);
  return undefined;
}

/** Minimal CSV line parser (handles quoted fields with commas). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export async function toggleFaqAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  const articleId = String(formData.get("articleId") ?? "");
  const next = formData.get("next") === "published" ? "published" : "draft";
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);

  if (UUID_RE.test(articleId)) {
    await db
      .update(faqArticles)
      .set({ status: next, updatedAt: new Date() })
      .where(and(eq(faqArticles.id, articleId), eq(faqArticles.projectId, ctx.project.id)));
  }
  revalidatePath(`/${locale}/orgs/${orgSlug}/faq`);
}

export async function deleteFaqAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  const articleId = String(formData.get("articleId") ?? "");
  await requireMembership(locale, orgSlug, MANAGER_ROLES);
  const ctx = await requireProject(locale, orgSlug, projectSlug);

  if (UUID_RE.test(articleId)) {
    await db
      .delete(faqArticles)
      .where(and(eq(faqArticles.id, articleId), eq(faqArticles.projectId, ctx.project.id)));
  }
  revalidatePath(`/${locale}/orgs/${orgSlug}/faq`);
}
