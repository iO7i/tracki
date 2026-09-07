import "server-only";

import { db } from "@/db";
import { faqArticles, projects } from "@/db/schema";
import { scoreArticle, searchTokens } from "@tracki/shared";
import { and, desc, eq, ilike } from "drizzle-orm";

export interface PublicArticle {
  id: string;
  slug: string;
  category: string;
  titleAr: string;
  bodyAr: string;
  titleEn: string;
  bodyEn: string;
}

const cols = {
  id: faqArticles.id,
  slug: faqArticles.slug,
  category: faqArticles.category,
  titleAr: faqArticles.titleAr,
  bodyAr: faqArticles.bodyAr,
  titleEn: faqArticles.titleEn,
  bodyEn: faqArticles.bodyEn,
};

/** Resolve a project by its public key (for the public, unauthenticated help center). */
export async function projectByPublicKey(publicKey: string) {
  const rows = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.publicKey, publicKey))
    .limit(1);
  return rows[0] ?? null;
}

/** Published articles for a project, optionally filtered by Arabic-aware search. */
export async function searchPublishedArticles(
  projectId: string,
  query: string,
): Promise<PublicArticle[]> {
  const tokens = searchTokens(query).slice(0, 8);
  const conditions = [
    eq(faqArticles.projectId, projectId),
    eq(faqArticles.status, "published"),
    ...tokens.map((t) => ilike(faqArticles.searchText, `%${t}%`)),
  ];
  // Select search_text for ranking (Audit M1) but strip it from the returned
  // PublicArticle; deterministic order for the list-all case (Audit N1).
  const rows = await db
    .select({ ...cols, searchText: faqArticles.searchText })
    .from(faqArticles)
    .where(and(...conditions))
    .orderBy(desc(faqArticles.updatedAt))
    .limit(50);

  const ranked =
    tokens.length === 0
      ? rows
      : rows
          .map((r) => ({
            r,
            score: scoreArticle(`${r.titleAr} ${r.titleEn}`, r.searchText, tokens),
          }))
          .sort((a, b) => b.score - a.score)
          .map(({ r }) => r);

  return ranked.map(({ searchText: _searchText, ...rest }) => rest);
}

export async function publishedArticleBySlug(
  projectId: string,
  slug: string,
): Promise<PublicArticle | null> {
  const rows = await db
    .select(cols)
    .from(faqArticles)
    .where(
      and(
        eq(faqArticles.projectId, projectId),
        eq(faqArticles.slug, slug),
        eq(faqArticles.status, "published"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
