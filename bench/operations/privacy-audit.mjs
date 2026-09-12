import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = parseArgs(process.argv.slice(2));
const output = resolve(String(args.output ?? "evidence/privacy-audit/latest"));
const generatedAt = new Date().toISOString();
const gitSha = gitRevision();
const failures = [];

const runtimeRoots = [
  "apps/ingest/src",
  "apps/dashboard/src",
  "packages/shared/src",
  "packages/clickhouse/src",
  "packages/whatsapp/src",
];
const runtimeFiles = (await collectFiles(runtimeRoots)).filter(
  (path) => !/\.test\.|[\\/]__tests__[\\/]/.test(path) && !/[\\/]migrate\.ts$/.test(path),
);

const runtimeLogFindings = [];
for (const path of runtimeFiles) {
  const text = await readFile(path, "utf8");
  for (const match of text.matchAll(/console\.(log|info|warn|error)\s*\(([\s\S]*?)\);/g)) {
    const argsText = match[2] ?? "";
    if (
      /\b(?:err|error|payload|body|props|token|authorization|secret|password|userId|anonId|sessionId|email|phone)\b/i.test(
        argsText,
      )
    ) {
      runtimeLogFindings.push({
        file: relative(root, path).replaceAll("\\", "/"),
        line: lineNumber(text, match.index ?? 0),
        method: match[1],
      });
    }
  }
}

const metricsPath = resolve(root, "apps/ingest/src/metrics.ts");
const metricsText = await readFile(metricsPath, "utf8");
if (!/aggregate only/i.test(metricsText) || /labels\s*[:=]/i.test(metricsText)) {
  failures.push("metrics surface is not clearly aggregate-only");
}

const tenantQueries = [];
for (const path of await collectFiles(["packages/clickhouse/src"])) {
  if (!path.endsWith(".ts") || path.endsWith("/index.ts") || path.endsWith("/client.ts")) continue;
  const text = await readFile(path, "utf8");
  for (const match of text.matchAll(/`([\s\S]*?)`/g)) {
    const sql = match[1] ?? "";
    if (!/\b(?:FROM|JOIN)\s+(?:events|struggles)\b/i.test(sql)) continue;
    const trackWindowReference = /\$\{\s*TRACK_WINDOW\s*\}/.test(sql);
    const hasOrg = /\borg_id\b/i.test(sql) || trackWindowReference;
    const hasProject = /\bproject_id\b/i.test(sql) || trackWindowReference;
    const interpolatesTenant = /\$\{\s*(?:orgId|projectId)\s*\}/.test(sql);
    tenantQueries.push({
      file: relative(root, path).replaceAll("\\", "/"),
      line: lineNumber(text, match.index ?? 0),
      hasOrg,
      hasProject,
      interpolatesTenant,
    });
    if (!hasOrg || !hasProject) {
      failures.push(
        `tenant predicate missing in ${relative(root, path)}:${lineNumber(text, match.index ?? 0)}`,
      );
    }
    if (interpolatesTenant) {
      failures.push(
        `tenant value interpolated into SQL in ${relative(root, path)}:${lineNumber(text, match.index ?? 0)}`,
      );
    }
  }

  const trackWindow = text.match(/const TRACK_WINDOW\s*=\s*["']([\s\S]*?)["'];/);
  if (
    trackWindow &&
    (!/\borg_id\b/i.test(trackWindow[1]) || !/\bproject_id\b/i.test(trackWindow[1]))
  ) {
    failures.push(`TRACK_WINDOW is missing an org/project predicate in ${relative(root, path)}`);
  }
}

const sensitiveBenchFiles = ["apps/ingest/bench/e2e-check.mjs", "apps/ingest/bench/faq-check.mjs"];
const benchLogFindings = [];
for (const relativePath of sensitiveBenchFiles) {
  const path = resolve(root, relativePath);
  const text = await readFile(path, "utf8");
  for (const match of text.matchAll(/console\.(log|info|warn|error)\s*\(([\s\S]*?)\);/g)) {
    const argsText = match[2] ?? "";
    if (/\b(?:r\.url|r\.props|searchRow\?\.q)\b/.test(argsText)) {
      benchLogFindings.push({ file: relativePath, line: lineNumber(text, match.index ?? 0) });
    }
  }
}

const artifactFindings = [];
let evidenceFilesChecked = 0;
const evidenceRoot = resolve(root, "evidence");
if (await exists(evidenceRoot)) {
  const artifactPatterns = [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /(?:\+|00)\d[\d\s-]{7,}\d/,
    /\b(?:sk-|ghp_|xox[baprs]-|AKIA[0-9A-Z]{16})[A-Za-z0-9_-]*/,
    /\bBearer\s+[A-Za-z0-9._-]{12,}/i,
    /\b(?:password|authorization|cookie|api[_-]?key)\s*[:=]\s*[^\s"']+/i,
  ];
  for (const path of await collectFiles(["evidence"])) {
    if (path.endsWith("/README.md") || path.endsWith("/index.json")) continue;
    evidenceFilesChecked += 1;
    const text = await readFile(path, "utf8");
    for (const pattern of artifactPatterns) {
      if (pattern.test(text)) {
        artifactFindings.push({ file: relative(root, path).replaceAll("\\", "/") });
        break;
      }
    }
  }
}

if (runtimeLogFindings.length)
  failures.push("runtime logging includes a potentially sensitive value");
if (benchLogFindings.length) failures.push("privacy-sensitive bench prints a stored value");
if (artifactFindings.length) failures.push("generated evidence contains a secret/PII pattern");

const report = {
  schemaVersion: 1,
  generatedAt,
  gitSha,
  status: failures.length ? "fail" : "pass",
  privacy: "metadata-only; report contains paths and counts, not source lines or payloads",
  checks: {
    tenantQueriesChecked: tenantQueries.length,
    tenantViolations: tenantQueries.filter(
      (q) => !q.hasOrg || !q.hasProject || q.interpolatesTenant,
    ).length,
    runtimeLogsChecked: runtimeFiles.length,
    unsafeRuntimeLogCalls: runtimeLogFindings,
    metricsAggregateOnly: !failures.includes("metrics surface is not clearly aggregate-only"),
    sensitiveBenchFilesChecked: sensitiveBenchFiles.length,
    unsafeBenchLogCalls: benchLogFindings,
    evidenceFilesChecked,
    artifactFindings,
  },
  failures,
};

await mkdir(output, { recursive: true });
const reportPath = resolve(output, "report.json");
const reportText = `${JSON.stringify(report, null, 2)}\n`;
await writeFile(reportPath, reportText);
const manifest = {
  schemaVersion: 1,
  generatedAt,
  gitSha,
  runId: output.split(/[\\/]/).pop() ?? "latest",
  artifact: "privacy-audit",
  artifacts: {
    "report.json": { bytes: Buffer.byteLength(reportText), sha256: sha256(reportText) },
  },
};
await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

if (failures.length) {
  for (const failure of failures) process.stderr.write(`FAIL: ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Privacy audit PASS: ${tenantQueries.length} tenant query templates, ${runtimeFiles.length} runtime files, and generated evidence checked.`,
  );
  process.stdout.write(`\nEvidence: ${relative(root, reportPath).replaceAll("\\", "/")}\n`);
}

async function collectFiles(relativeRoots) {
  const files = [];
  for (const relativeRoot of relativeRoots) {
    const absoluteRoot = resolve(root, relativeRoot);
    if (!(await exists(absoluteRoot))) continue;
    await walk(absoluteRoot, files);
  }
  return files;
}

async function walk(directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path, files);
    else files.push(path);
  }
}

async function exists(path) {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitRevision() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
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
