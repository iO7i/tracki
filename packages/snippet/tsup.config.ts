import { defineConfig } from "tsup";

export default defineConfig({
  entry: { tracki: "src/index.ts" },
  format: ["iife"],
  globalName: "__tracki_boot",
  minify: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  outDir: "dist",
});
