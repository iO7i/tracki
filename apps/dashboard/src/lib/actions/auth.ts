"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { type ActionState, safeNextPath } from "@/lib/action-state";
import {
  TIMING_BURN_HASH,
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";
import { allowRate } from "@/lib/redis";
import { loginSchema, signupSchema } from "@tracki/shared";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

function localeFrom(formData: FormData): string {
  const locale = formData.get("locale");
  return locale === "en" ? "en" : "ar";
}

/** Best-effort client IP for rate-limit keys (behind a proxy/CDN in prod). */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function signupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  // A07: throttle mass account creation per IP.
  if (!(await allowRate(`signup:ip:${await clientIp()}`, 5, 600))) {
    return { error: "errors.tooMany" };
  }
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "errors.generic" };
  }
  const { name, email, password } = parsed.data;

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing.length > 0) {
    return { error: "errors.emailTaken" };
  }

  const passwordHash = await hashPassword(password);
  let userId: string;
  try {
    const inserted = await db
      .insert(users)
      .values({ name, email, passwordHash })
      .returning({ id: users.id });
    // biome-ignore lint/style/noNonNullAssertion: insert returns exactly one row
    userId = inserted[0]!.id;
  } catch {
    // Unique-constraint race on email.
    return { error: "errors.emailTaken" };
  }

  await createSession(userId);
  redirect(safeNextPath(formData.get("next")) ?? `/${locale}/orgs`);
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  // A07: throttle online password guessing — per IP and per targeted email.
  if (!(await allowRate(`login:ip:${await clientIp()}`, 10, 60))) {
    return { error: "errors.tooMany" };
  }
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "errors.generic" };
  }
  if (!(await allowRate(`login:em:${parsed.data.email}`, 5, 300))) {
    return { error: "errors.tooMany" };
  }

  const rows = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);
  const user = rows[0];

  // Always burn a full bcrypt comparison so missing-account and wrong-password
  // take similar time (Audit B1: the hash must be structurally valid or
  // bcryptjs short-circuits and leaks account existence).
  const valid = await verifyPassword(parsed.data.password, user?.passwordHash ?? TIMING_BURN_HASH);
  if (!user || !valid) {
    return { error: "errors.invalidCredentials" };
  }

  await createSession(user.id);
  redirect(safeNextPath(formData.get("next")) ?? `/${locale}/orgs`);
}

export async function logoutAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  await destroySession();
  redirect(`/${locale}/login`);
}
