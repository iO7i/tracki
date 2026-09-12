import { existsSync, readFileSync } from "node:fs";

const root = new URL("../..", import.meta.url);
const rootPath = (relative) => new URL(relative, root);
const read = (relative) => readFileSync(rootPath(relative), "utf8");
const failures = [];

function requireFile(relative) {
  if (!existsSync(rootPath(relative))) failures.push(`missing tracked path: ${relative}`);
}

function requireText(relative, text) {
  requireFile(relative);
  if (existsSync(rootPath(relative)) && !read(relative).includes(text)) {
    failures.push(`workflow contract missing ${JSON.stringify(text)} in ${relative}`);
  }
}

for (const path of [
  "docs/acceptance-matrix.json",
  ".github/workflows/ci.yml",
  ".github/workflows/native.yml",
  "bench/operations/adversarial-fuzz.ts",
  "bench/operations/friction-benchmark.ts",
  "bench/operations/privacy-audit.mjs",
  "apps/ingest/src/server.contract.test.ts",
  "apps/ingest/src/privacy.contract.test.ts",
  "apps/ingest/bench/seed-operations.mjs",
  "docs/SERVICE-VERIFICATION.md",
  "docs/RELEASE-CHECKLIST.md",
  "docs/RISK-REGISTER.md",
  "docs/PR-DESCRIPTION.md",
  "sdks/flutter/example/main.dart",
  "sdks/android/consumer/build.gradle.kts",
  "sdks/android/consumer/src/main/AndroidManifest.xml",
])
  requireFile(path);

requireText(".github/workflows/ci.yml", "pnpm ops:verify");
requireText(".github/workflows/ci.yml", "--iterations=10000");
requireText(".github/workflows/ci.yml", "tracki-fuzz-*.json*");
requireText(".github/workflows/ci.yml", "behavioral-evidence");
requireText(".github/workflows/ci.yml", "if-no-files-found: error");
requireText(".github/workflows/ci.yml", "pnpm ops:preflight");
requireText(".github/workflows/ci.yml", "pnpm ops:privacy-audit");
requireText(".github/workflows/ci.yml", "tracki-privacy-audit");
requireText(".github/workflows/native.yml", "workflow-contract:");
requireText(".github/workflows/native.yml", "flutter-consumer-apk");
requireText(".github/workflows/native.yml", "android-consumer-apk");
requireText(".github/workflows/native.yml", "flutter build apk --debug");
requireText(".github/workflows/native.yml", "swift test --package-path sdks/ios");
requireText(
  ".github/workflows/native.yml",
  "gradle -p sdks/android :sdk:lint :consumer:assembleDebug",
);
requireText(".github/workflows/native.yml", "if-no-files-found: error");

if (!failures.length) {
  const matrix = JSON.parse(read("docs/acceptance-matrix.json"));
  const statuses = new Set(matrix.statusVocabulary);
  if (!Array.isArray(matrix.entries) || matrix.entries.length < 10) {
    failures.push("acceptance matrix must contain at least 10 entries");
  }
  const ids = new Set();
  for (const entry of matrix.entries ?? []) {
    if (!entry.id || ids.has(entry.id)) {
      failures.push(`acceptance matrix duplicate/missing id: ${entry.id}`);
    }
    ids.add(entry.id);
    if (!statuses.has(entry.status)) {
      failures.push(`unknown status for ${entry.id}: ${entry.status}`);
    }
    if (!Array.isArray(entry.proof) || entry.proof.length === 0) {
      failures.push(`acceptance matrix has no proof for ${entry.id}`);
    }
    if (!entry.acceptanceThresholds || typeof entry.acceptanceThresholds !== "object") {
      failures.push(`acceptance matrix has no thresholds object for ${entry.id}`);
    }
    for (const [name, threshold] of Object.entries(entry.acceptanceThresholds ?? {})) {
      const operators = ["=", "<", "<=", ">", ">=", "not_run", "not_set"];
      if (
        !threshold ||
        typeof threshold !== "object" ||
        !operators.includes(threshold.operator) ||
        typeof threshold.unit !== "string"
      ) {
        failures.push(`invalid threshold ${name} for ${entry.id}`);
      } else if (["not_run", "not_set"].includes(threshold.operator) && threshold.value !== null) {
        failures.push(`unmeasured threshold ${name} for ${entry.id} must have null value`);
      } else if (!["not_run", "not_set"].includes(threshold.operator) && threshold.value === null) {
        failures.push(`measured threshold ${name} for ${entry.id} must have a value`);
      }
    }
    for (const proof of entry.proof ?? []) {
      if (proof.kind === "tracked") requireFile(proof.path);
      if (!proof.path || !["tracked", "generated"].includes(proof.kind)) {
        failures.push(`invalid proof descriptor for ${entry.id}`);
      }
    }
  }
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`::error title=CI contract::${failure}`);
  }
  process.exitCode = 1;
} else {
  // biome-ignore lint/suspicious/noConsole: command-line contract summary
  console.log(
    "CI contract OK: acceptance matrix, workflow commands, artifact paths, and native consumer inputs are present.",
  );
}
