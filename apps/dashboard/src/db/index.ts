import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

// postgres-js connects lazily; safe to construct at module scope.
const client = postgres(databaseUrl);

export const db = drizzle(client, { schema });

/**
 * Audit M1: catch blocks around inserts must only swallow unique-constraint
 * violations (Postgres 23505) — anything else (DB down, FK violation,
 * deadlock) is a real failure and must propagate.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23505"
  );
}
