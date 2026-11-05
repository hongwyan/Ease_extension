import { defineConfig } from "@playwright/test";

/** Performance benchmark (real inference, 1,000 posts). Run with `npm run bench`. */
export default defineConfig({
  testDir: "tests/bench",
  timeout: 1_200_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
