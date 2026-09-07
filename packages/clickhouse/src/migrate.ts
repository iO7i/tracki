import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClickHouse } from "./client";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "migrations");

/**
 * Minimal migration runner: applies every .sql file in migrations/ in name
 * order, tracking applied names in a `_migrations` table. Statements are split
 * on `;`. Idempotent — already-applied files are skipped.
 */
export async function migrate(): Promise<string[]> {
  const client = createClickHouse();
  const applied: string[] = [];
  try {
    await client.command({
      query:
        "CREATE TABLE IF NOT EXISTS _migrations (name String, applied_at DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY name",
    });

    const existing = new Set<string>();
    const rs = await client.query({ query: "SELECT name FROM _migrations", format: "JSONEachRow" });
    for (const row of await rs.json<{ name: string }>()) existing.add(row.name);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (existing.has(file)) continue;
      const raw = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      // Strip line comments BEFORE splitting — a `;` inside a comment must not
      // break statement boundaries.
      const sql = raw
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      for (const stmt of sql.split(";")) {
        const trimmed = stmt.trim();
        if (trimmed) await client.command({ query: trimmed });
      }
      await client.insert({
        table: "_migrations",
        values: [{ name: file }],
        format: "JSONEachRow",
      });
      applied.push(file);
    }
    return applied;
  } finally {
    await client.close();
  }
}

// Run directly: `tsx src/migrate.ts`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate()
    .then((applied) => {
      console.info(
        applied.length
          ? `ClickHouse migrations applied: ${applied.join(", ")}`
          : "ClickHouse up to date",
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("ClickHouse migration failed:", err);
      process.exit(1);
    });
}
