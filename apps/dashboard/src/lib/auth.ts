import "server-only";

import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import {
  SESSION_COOKIE_NAME,
  hashSessionToken,
  isSessionExpired,
  randomToken,
  sessionExpiryFrom,
} from "@tracki/shared";
import bcrypt from "bcryptjs";
import { and, eq, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";

const BCRYPT_ROUNDS = 12;

/**
 * Audit B1: structurally VALID precomputed bcrypt hash (60 chars) used to burn
 * a full KDF comparison when the account doesn't exist, so login timing does
 * not leak account existence. bcryptjs short-circuits on malformed hashes —
 * the shape is asserted at module load to prevent silent regression.
 */
export const TIMING_BURN_HASH = "$2a$12$rR62H3W3e/8KzgF.H/R/ZOVtJ8jU2sH1jgj908cfveJOjQmBX6lZO";
if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(TIMING_BURN_HASH)) {
  throw new Error("TIMING_BURN_HASH is not a structurally valid bcrypt hash");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Audit N2: Secure on anything that isn't local dev (staging included).
    secure: process.env.NODE_ENV !== "development",
    path: "/",
    expires,
  };
}

/** Issues a session row + cookie. Only callable from server actions / route handlers. */
export async function createSession(userId: string): Promise<void> {
  const token = randomToken(40);
  const now = new Date();
  const expiresAt = sessionExpiryFrom(now);
  // Audit M3: opportunistically reclaim this user's expired sessions on login
  // so the table doesn't grow unboundedly. A global sweep job is a implementation item.
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, now)));
  await db.insert(sessions).values({
    tokenHash: hashSessionToken(token),
    userId,
    expiresAt,
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, cookieOptions(expiresAt));
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
  }
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
};

/**
 * Validates the session cookie against the DB. Cached per request.
 * Expired sessions are treated as absent; their rows are reclaimed by the
 * per-user cleanup in createSession (see Audit M3).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, hashSessionToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (isSessionExpired(row.expiresAt, new Date())) return null;

  return { id: row.userId, email: row.email, name: row.name };
});
