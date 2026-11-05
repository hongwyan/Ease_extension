// Semantic evaluation entry point.
//   node scripts/semantic-eval.mjs node [modelId ...]  → candidate comparison in Node (model selection)
//   node scripts/semantic-eval.mjs browser             → release gate inside the packaged extension (Playwright)
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [mode = "browser", ...rest] = process.argv.slice(2);

if (mode === "node") {
  mkdirSync(join(root, ".cache/tmp"), { recursive: true });
  const out = join(root, ".cache/tmp/node-eval.mjs");
  await build({
    entryPoints: [join(root, "tests/semantic/node-eval.ts")],
    outfile: out,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["@huggingface/transformers"],
    logLevel: "warning",
  });
  const r = spawnSync(process.execPath, [out, ...rest], { stdio: "inherit", cwd: root });
  process.exit(r.status ?? 1);
} else {
  const r = spawnSync(process.execPath, [join(root, "scripts/pw.mjs"), "test", "--config", "playwright.semantic.config.ts", ...rest], {
    stdio: "inherit",
    cwd: root,
  });
  process.exit(r.status ?? 1);
}
