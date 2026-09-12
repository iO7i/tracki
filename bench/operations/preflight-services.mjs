import net from "node:net";

const targets = [
  { name: "PostgreSQL", host: process.env.PREFLIGHT_PG_HOST ?? "127.0.0.1", port: 5432 },
  { name: "Redis", host: process.env.PREFLIGHT_REDIS_HOST ?? "127.0.0.1", port: 6379 },
  { name: "ClickHouse", host: process.env.PREFLIGHT_CH_HOST ?? "127.0.0.1", port: 8123 },
];
const timeoutMs = Number(process.env.PREFLIGHT_TIMEOUT_MS ?? 3_000);
const results = await Promise.all(targets.map(probe));
const failed = results.filter((result) => !result.ok);

if (failed.length) {
  for (const result of failed) {
    console.error(
      `::error title=Service preflight::${result.name} is unavailable at ${result.host}:${result.port}. Start the Postgres 16, Redis 7, and ClickHouse 24.8 services or inspect the CI service container health checks.`,
    );
  }
  process.exitCode = 1;
} else {
  // biome-ignore lint/suspicious/noConsole: command-line preflight summary
  console.log(
    `Service preflight OK: ${results.map((result) => `${result.name}=${result.host}:${result.port}`).join(", ")}`,
  );
}

function probe(target) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: target.host, port: target.port });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ...target, ok });
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
