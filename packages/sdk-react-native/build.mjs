import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.build.json"],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: [
    "@io7i/tracki-mobile-core",
    "react",
    "react/*",
    "react-native",
    "@react-native-async-storage/async-storage",
  ],
  sourcemap: true,
});
