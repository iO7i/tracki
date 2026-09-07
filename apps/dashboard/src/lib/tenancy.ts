import "server-only";

import { db } from "@/db";
import { memberships, organizations, projects } from "@/db/schema";
import type { OrgRole } from "@tracki/shared";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { type CurrentUser, getCurrentUser } from "./auth";

/**
 * Tenancy rule (cross-cutting, slice 0+): every org/project read goes through
 * these guards. Non-members get a 404 — org slugs must not be probeable.
 */

export async function requireUser(locale: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  return user;
}

/**
 * Platform staff = an explicit allowlist of emails in TRACKI_ADMIN_EMAILS
 * (comma-separated). Used to gate the cross-tenant admin views (e.g. demo
 * leads). Empty/unset ⇒ nobody is staff (secure default).
 */
export function isStaff(email: string): boolean {
  const allow = (process.env.TRACKI_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.toLowerCase());
}

/** Require a logged-in platform-staff user; non-staff get a 404 (route hidden). */
export async function requireStaff(locale: string): Promise<CurrentUser> {
  const user = await requireUser(locale);
  if (!isStaff(user.email)) notFound();
  return user;
}

export type OrgContext = {
  user: CurrentUser;
  org: { id: string; name: string; slug: string };
  role: OrgRole;
};

export async function requireMembership(
  locale: string,
  orgSlug: string,
  allowedRoles?: readonly OrgRole[],
): Promise<OrgContext> {
  const user = await requireUser(locale);

  const rows = await db
    .select({
      orgId: organizations.id,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(and(eq(memberships.userId, user.id), eq(organizations.slug, orgSlug)))
    .limit(1);

  const row = rows[0];
  if (!row) notFound();
  if (allowedRoles && !allowedRoles.includes(row.role)) notFound();

  return {
    user,
    org: { id: row.orgId, name: row.orgName, slug: row.orgSlug },
    role: row.role,
  };
}

export async function requireProject(locale: string, orgSlug: string, projectSlug: string) {
  const ctx = await requireMembership(locale, orgSlug);
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.orgId, ctx.org.id), eq(projects.slug, projectSlug)))
    .limit(1);
  const project = rows[0];
  if (!project) notFound();
  return { ...ctx, project };
}

/**
 * Route-handler-safe variant: resolves a project for the current user without
 * throwing redirect/notFound (those are page-only). Returns null when the user
 * isn't a member or the project doesn't belong to the org — callers return 404.
 */
export async function resolveProjectForUser(
  orgSlug: string,
  projectSlug: string,
): Promise<{ orgId: string; projectId: string } | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const rows = await db
    .select({ orgId: organizations.id, projectId: projects.id })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .innerJoin(projects, eq(projects.orgId, organizations.id))
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(organizations.slug, orgSlug),
        eq(projects.slug, projectSlug),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
