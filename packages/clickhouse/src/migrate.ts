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
  const retention = Number(process.env.TELEMETRY_RETENTION_DAYS ?? 90);
  if (!Number.isInteger(retention) || retention < 1 || retention > 3650)
    throw new Error("invalid telemetry retention");
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
      if (file === "006_reliable_delivery.sql") {
        await upgradeReplacing(client, "events", "event_id");
        await upgradeReplacing(client, "struggles", "struggle_id");
      }
      // Preserve historical SQL unchanged but never execute its destructive DROP.
      if (file === "003_events_dedup.sql") {
        await upgradeReplacing(client, "events", "event_id");
        await client.insert({
          table: "_migrations",
          values: [{ name: file }],
          format: "JSONEachRow",
        });
        applied.push(file);
        continue;
      }
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
    await client.command({
      query: `ALTER TABLE events MODIFY TTL toDateTime(received_at) + INTERVAL ${retention} DAY DELETE`,
    });
    await client.command({
      query: `ALTER TABLE struggles MODIFY TTL toDateTime(ts) + INTERVAL ${retention} DAY DELETE`,
    });
    // Retained rollback copies contain telemetry too; the same retention applies.
    for (const table of ["events", "struggles"] as const) {
      const backup = `${table}_before_reliable_delivery`;
      const rs = await client.query({
        query: "EXISTS TABLE {name:Identifier}",
        query_params: { name: backup },
        format: "JSONEachRow",
      });
      if (Number((await rs.json<{ result: number }>())[0]?.result)) {
        await client.command({
          query: `ALTER TABLE ${backup} MODIFY TTL toDateTime(${table === "events" ? "received_at" : "ts"}) + INTERVAL ${retention} DAY DELETE`,
        });
      }
    }
    return applied;
  } finally {
    await client.close();
  }
}

/** Run with producers/workers stopped. Atomic exchange retains the old table for rollback.
 * Restart after any step is safe: an exchanged ReplacingMergeTree needs no second copy.
 */
async function upgradeReplacing(
  client: ReturnType<typeof createClickHouse>,
  table: "events" | "struggles",
  id: "event_id" | "struggle_id",
): Promise<void> {
  const result = await client.query({
    query:
      "SELECT engine FROM system.tables WHERE database=currentDatabase() AND name={name:String}",
    query_params: { name: table },
    format: "JSONEachRow",
  });
  const rows = await result.json<{ engine: string }>();
  if (rows[0]?.engine === "ReplacingMergeTree") return;
  const shadow = `${table}_before_reliable_delivery`;
  await client.command({
    query: `CREATE TABLE IF NOT EXISTS ${shadow} AS ${table} ENGINE=ReplacingMergeTree PARTITION BY toYYYYMM(ts) ORDER BY (org_id,project_id,ts,${id})`,
  });
  await client.command({ query: `INSERT INTO ${shadow} SELECT * FROM ${table}` });
  await client.command({ query: `EXCHANGE TABLES ${table} AND ${shadow}` });
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
