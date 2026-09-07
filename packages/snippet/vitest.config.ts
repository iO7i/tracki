import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "jsdom",
    // A real origin so localStorage works (opaque about:blank origin throws).
    environmentOptions: { jsdom: { url: "http://localhost/" } },
  },
});
