import { defineConfig } from "@playwright/test";

/** Semantic release gate (real packaged inference). Run with `npm run eval:semantic`. */
export default defineConfig({
  testDir: "tests/semantic",
  testMatch: /.*\.spec\.ts$/,
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
