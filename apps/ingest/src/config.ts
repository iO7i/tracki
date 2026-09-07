export const config = {
  port: Number(process.env.INGEST_PORT ?? 4000),
  host: process.env.INGEST_HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://tracki:tracki@localhost:5432/tracki",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  // Run the ClickHouse writer loop in this process (dev). In prod, run a
  // separate process with INGEST_RUN_WORKER=true and the API with =false.
  runWorker: process.env.INGEST_RUN_WORKER !== "false",
  runServer: process.env.INGEST_RUN_SERVER !== "false",
  keyCacheTtlSec: 60,
  negativeKeyCacheTtlSec: 10,
  rateLimitPerSec: Number(process.env.INGEST_RATE_LIMIT ?? 2000),
} as const;

export const REDIS_KEYS = {
  buffer: "events:buffer",
  processing: "events:processing",
  dead: "events:dead",
  keyCache: (pk: string) => `key:${pk}`,
  actionManifest: (projectId: string) => `manifest:${projectId}`,
  struggleActions: (projectId: string) => `struggleactions:${projectId}`,
  assist: (projectId: string, sessionId: string) => `assist:${projectId}:${sessionId}`,
  liveChannel: (projectId: string) => `live:${projectId}`,
  struggleChannel: (projectId: string) => `struggles:${projectId}`,
  rateLimit: (pk: string, windowSec: number) => `rl:${pk}:${windowSec}`,
} as const;
