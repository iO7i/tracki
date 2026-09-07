import { defineConfig, devices } from "@playwright/test";

/**
 * Slice-0 smoke suite. Expects the dev stack to be running:
 *   docker compose -f infra/docker-compose.yml up -d
 *   pnpm db:migrate && pnpm dev
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
