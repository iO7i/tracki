import { readFile } from "node:fs/promises";
import postgres from "postgres";
if (process.env.TRACKI_APPLY_NATIVE_MIGRATION !== "yes" || !process.env.DATABASE_URL)
  throw new Error(
    "Explicit DATABASE_URL and TRACKI_APPLY_NATIVE_MIGRATION=yes required for collector telemetry migration",
  );
const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 3 });
try {
  await sql.begin(async (tx) => {
    await tx.unsafe(
      await readFile(
        new URL("../src/cco/migrations/001_native_diagnostics.sql", import.meta.url),
        "utf8",
      ),
    );
  });
  console.info("Native telemetry schema applied; no merchant app/business tables changed.");
} finally {
  await sql.end();
}
