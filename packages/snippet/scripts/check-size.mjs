import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, "..", "dist", "tracki.global.js");
const BUDGET_BYTES = 30 * 1024;

let raw;
try {
  raw = readFileSync(file);
} catch {
  console.error(
    `Snippet bundle not found at ${file} — run \`pnpm --filter @tracki/snippet build\` first.`,
  );
  process.exit(1);
}

const gz = gzipSync(raw).length;
const kb = (gz / 1024).toFixed(2);
if (gz > BUDGET_BYTES) {
  console.error(`Snippet too large: ${kb}KB gzipped (budget 30KB).`);
  process.exit(1);
}
console.info(`Snippet size OK: ${kb}KB gzipped (budget 30KB).`);
