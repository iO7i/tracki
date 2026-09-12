import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
const args = parseArgs(process.argv.slice(2));
const rawPath = args.raw;
const projectId = args["project-id"];
if (!rawPath || !projectId) {
  console.error(
    "Usage: pnpm ops:reconcile -- --raw=<raw.json> --project-id=<uuid> [--output=<json>]",
  );
  process.exitCode = 2;
} else {
  await reconcile();
}

async function reconcile() {
  const raw = JSON.parse(await readFile(rawPath, "utf8"));
  const clientIds = [
    ...new Set(
      (raw.levels ?? []).flatMap((level) =>
        (level.attempts ?? []).flatMap((attempt) => attempt.eventIds ?? []),
      ),
    ),
  ];
  const databaseUrl =
    args["database-url"] ??
    process.env.DATABASE_URL ??
    "postgres://tracki:tracki@localhost:5432/tracki";
  const clickhouseUrl =
    args["clickhouse-url"] ?? process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
  const sql = require("postgres")(databaseUrl, { max: 1, connect_timeout: 5 });
  let ledger;
  let clickhouse;
  const errors = [];
  try {
    const project = await sql`SELECT org_id FROM projects WHERE id = ${projectId} LIMIT 1`;
    const orgId = project[0]?.org_id;
    if (!orgId) throw new Error("project not found or org_id unavailable");
    const storedIds = clientIds.map((eventId) => digest(orgId, projectId, eventId));
    const acceptedAtByClientId = new Map();
    for (const level of raw.levels ?? []) {
      for (const attempt of level.attempts ?? []) {
        if (attempt.acceptedAt) {
          for (const clientEventId of attempt.eventIds ?? []) {
            if (!acceptedAtByClientId.has(clientEventId)) {
              acceptedAtByClientId.set(clientEventId, attempt.acceptedAt);
            }
          }
        }
      }
    }
    ledger = await sql`
      SELECT event_id, completed_at, attempts, dead_at, payload IS NOT NULL AS payload_present
      FROM telemetry_inbox
      WHERE project_id = ${projectId} AND event_id = ANY(${sql.array(storedIds)})`;
    clickhouse = require("@clickhouse/client").createClient({
      url: clickhouseUrl,
      username: args["clickhouse-user"] ?? process.env.CLICKHOUSE_USER ?? "tracki",
      password: args["clickhouse-password"] ?? process.env.CLICKHOUSE_PASSWORD ?? "tracki",
      database: args["clickhouse-database"] ?? process.env.CLICKHOUSE_DB ?? "tracki",
    });
    const response = await clickhouse.query({
      query: `
        SELECT event_id, count() AS physical_count, min(received_at) AS first_received_at
        FROM events
        WHERE project_id = {project:String}
          AND event_id IN {ids:Array(String)}
        GROUP BY event_id`,
      query_params: { project: projectId, ids: storedIds },
      format: "JSONEachRow",
    });
    const rows = await response.json();
    const ledgerById = new Map(ledger.map((row) => [row.event_id, row]));
    const clickhouseById = new Map(
      rows.map((row) => [row.event_id, { ...row, physical_count: Number(row.physical_count) }]),
    );
    const details = storedIds.map((eventId, index) => {
      const ledgerRow = ledgerById.get(eventId) ?? null;
      const acceptedAt = acceptedAtByClientId.get(clientIds[index]) ?? null;
      const completedAt = ledgerRow?.completed_at
        ? new Date(ledgerRow.completed_at).toISOString()
        : null;
      return {
        clientEventId: clientIds[index],
        storedEventId: eventId,
        clientAcceptedAt: acceptedAt,
        eventToCompletionMs:
          acceptedAt && completedAt
            ? Math.max(0, Date.parse(completedAt) - Date.parse(acceptedAt))
            : null,
        ledger: ledgerRow,
        clickhouse: clickhouseById.get(eventId) ?? null,
      };
    });
    const completed = details.filter((detail) => detail.ledger?.completed_at);
    const dead = details.filter((detail) => detail.ledger?.dead_at);
    const missingClickHouse = completed.filter((detail) => !detail.clickhouse);
    const physicalDuplicates = details.filter(
      (detail) => (detail.clickhouse?.physical_count ?? 0) > 1,
    );
    const result = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      rawPath,
      projectId,
      clientEventCount: clientIds.length,
      ledgerRows: ledger.length,
      completedCount: completed.length,
      deadCount: dead.length,
      missingClickHouseCount: missingClickHouse.length,
      physicalDuplicateIdentityCount: physicalDuplicates.length,
      unknowns: [
        "detector state cannot be reconstructed from these stores",
        "provider-side WhatsApp delivery cannot be observed from telemetry reconciliation",
      ],
      details,
      errors,
    };
    const output = args.output ?? `${rawPath}.reconciliation.json`;
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
    // biome-ignore lint/suspicious/noConsole: command-line reconciliation summary
    console.log(JSON.stringify({ ...result, details: undefined }, null, 2));
    // biome-ignore lint/suspicious/noConsole: command-line evidence path
    console.log(`Evidence: ${output}`);
  } catch (error) {
    errors.push(String(error?.message ?? error));
    console.error(
      JSON.stringify(
        { schemaVersion: 1, projectId, clientEventCount: clientIds.length, errors },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
    if (clickhouse) await clickhouse.close().catch(() => {});
  }
}

function digest(orgId, projectIdValue, eventId) {
  return createHash("sha256")
    .update(canonical([orgId, projectIdValue, eventId]))
    .digest("hex")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith("--")) continue;
    const [name, inline] = value.slice(2).split("=", 2);
    result[name] = inline ?? values[index + 1] ?? "";
    if (inline === undefined) index += 1;
  }
  return result;
}
