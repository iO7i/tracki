import { readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const root = resolve(String(args.root ?? "evidence"));
const output = resolve(String(args.output ?? `${root}/index.json`));
const manifests = [];

for await (const path of walk(root)) {
  const filename = path.split(/[\\/]/).pop();
  if (path === output || (filename !== "manifest.json" && !path.endsWith(".manifest.json")))
    continue;
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    continue;
  }
  if (!value || typeof value !== "object") continue;
  const generatedAt = value.generatedAt ?? value.finishedAt ?? value.startedAt;
  if (!("schemaVersion" in value) || !generatedAt) continue;
  manifests.push({
    path: relative(resolve("."), path).replaceAll("\\", "/"),
    schemaVersion: value.schemaVersion,
    gitSha: value.gitSha ?? null,
    runId: value.runId ?? null,
    artifact: value.artifact ?? null,
    generatedAt,
    artifactNames: value.artifacts ? Object.keys(value.artifacts).sort() : [],
  });
}

manifests.sort((a, b) => a.path.localeCompare(b.path));
const index = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  root: relative(resolve("."), root).replaceAll("\\", "/"),
  privacy: "metadata-only index; raw payloads are not copied here",
  manifests,
};
await writeFile(output, `${JSON.stringify(index, null, 2)}\n`);
// biome-ignore lint/suspicious/noConsole: command-line evidence summary
console.log(
  `Evidence index: ${relative(resolve("."), output).replaceAll("\\", "/")} (${manifests.length} manifests)`,
);

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
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
