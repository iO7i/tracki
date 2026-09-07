import { type ClickHouseClient, createClient } from "@clickhouse/client";

export type { ClickHouseClient };

export interface ClickHouseEnv {
  url?: string;
  username?: string;
  password?: string;
  database?: string;
}

/** Build a ClickHouse client from explicit config or TRACKI_CLICKHOUSE_* env. */
export function createClickHouse(env: ClickHouseEnv = {}): ClickHouseClient {
  return createClient({
    url: env.url ?? process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
    username: env.username ?? process.env.CLICKHOUSE_USER ?? "tracki",
    password: env.password ?? process.env.CLICKHOUSE_PASSWORD ?? "tracki",
    database: env.database ?? process.env.CLICKHOUSE_DB ?? "tracki",
    clickhouse_settings: {
      // Deterministic for tests; revisit async_insert under load.
      async_insert: 0,
    },
  });
}
