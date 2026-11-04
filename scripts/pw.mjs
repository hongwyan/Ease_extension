// Runs the Playwright CLI with a project-local browser (node_modules/playwright-core/.local-browsers),
// so `npm run browsers` and `npm run test:e2e` always use the same Chromium build.
// Set PLAYWRIGHT_BROWSERS_PATH yourself to use a different location.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= "0";
const require = createRequire(import.meta.url);
const cli = require.resolve("@playwright/test/cli");
const r = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
