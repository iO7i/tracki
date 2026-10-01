import { PGlite } from "@electric-sql/pglite";
import type postgres from "postgres";

/** Real embedded PostgreSQL for isolated integration tests/local synthetic fixtures only. */
export async function nativeTestDb(directory?: string): Promise<{ db: PGlite; sql: postgres.Sql }> {
  const db = new PGlite(directory);
  await db.waitReady;
  const adapt = (query: {
    query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
  }): postgres.Sql => {
    const sql = Object.assign(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.reduce((out, part, i) => out + (i ? "$" + i : "") + part, "");
        return (await query.query(text, values)).rows;
      },
      {
        json: (value: unknown) => JSON.stringify(value),
        begin: async (fn: (tx: postgres.TransactionSql) => Promise<unknown>) =>
          db.transaction((tx) => fn(adapt(tx) as unknown as postgres.TransactionSql)),
      },
    );
    return sql as unknown as postgres.Sql;
  };
  return { db, sql: adapt(db) };
}
