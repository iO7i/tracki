import "server-only";

import { createClickHouse } from "@tracki/clickhouse";

// Single CH client for the dashboard's read queries.
let client: ReturnType<typeof createClickHouse> | null = null;

export function clickhouse() {
  if (!client) client = createClickHouse();
  return client;
}
