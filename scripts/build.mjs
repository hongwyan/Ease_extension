// Reproducible release build: `npm ci && npm run build` → dist/ (manifest at the root).
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");

// --- Mandatory local encoder assets (pinned in scripts/models.lock.json, fetched by `npm run model:fetch`). ---
const lock = JSON.parse(readFileSync(join(root, "scripts/models.lock.json"), "utf8"));
const releaseId = lock.release;
const release = lock.models[releaseId];
const modelSrc = readFileSync(join(root, "src/semantic/model.ts"), "utf8");
if (!modelSrc.includes(`modelId: "${releaseId}"`) || !modelSrc.includes(`revision: "${release.revision}"`)) {
  fail(`src/semantic/model.ts RELEASE_ENCODER does not match the lock's release model ${releaseId}@${release.revision}.`);
}
const cacheDir = join(root, ".cache", "models", release.revision, releaseId);
for (const [file, spec] of Object.entries(release.files)) {
  const p = join(cacheDir, file);
  if (!existsSync(p)) fail(`Missing encoder asset ${releaseId}/${file}. Run \`npm run model:fetch\` first.`);
  if (statSync(p).size !== spec.size || (await sha256(p)) !== spec.sha256) {
    fail(`Encoder asset ${releaseId}/${file} does not match its pinned SHA-256. Delete it and run \`npm run model:fetch\`.`);
  }
}
// CPU/WASM runtime: the WASM binary and its matching Emscripten loader from the pinned onnxruntime-web.
const ORT_FILES = ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"];
const ortDir = join(root, "node_modules/onnxruntime-web/dist");
for (const f of ORT_FILES) if (!existsSync(join(ortDir, f))) fail(`Missing ONNX Runtime file ${f}. Run \`npm ci\`.`);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "icons"), { recursive: true });

const common = {
  bundle: true,
  target: "chrome120",
  logLevel: "warning",
  legalComments: "none",
  sourcemap: false,
  minify: false,
  charset: "utf8",
};

await build({ ...common, entryPoints: [join(root, "src/content/index.ts")], outfile: join(out, "content.js"), format: "iife" });
await build({ ...common, entryPoints: [join(root, "src/background/index.ts")], outfile: join(out, "background.js"), format: "esm" });
await build({ ...common, entryPoints: [join(root, "src/popup/popup.ts")], outfile: join(out, "popup.js"), format: "esm" });
await build({ ...common, entryPoints: [join(root, "src/offscreen/offscreen.ts")], outfile: join(out, "offscreen.js"), format: "esm" });
// Inference worker: Transformers.js with the CPU/WASM-only ONNX Runtime build (no WebGPU/JSEP code or binaries).
await build({
  ...common,
  entryPoints: [join(root, "src/semantic/worker.ts")],
  outfile: join(out, "semantic-worker.js"),
  format: "esm",
  alias: { "onnxruntime-web/webgpu": "onnxruntime-web/wasm" },
  logOverride: { "empty-import-meta": "silent" },
});

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "static/manifest.json"), "utf8"));
manifest.version = pkg.version;
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(join(root, "static/popup.html"), join(out, "popup.html"));
cpSync(join(root, "static/popup.css"), join(out, "popup.css"));
cpSync(join(root, "static/offscreen.html"), join(out, "offscreen.html"));
mkdirSync(join(out, "ort"), { recursive: true });
for (const f of ORT_FILES) cpSync(join(ortDir, f), join(out, "ort", f));
for (const file of Object.keys(release.files)) {
  mkdirSync(dirname(join(out, "models", releaseId, file)), { recursive: true });
  cpSync(join(cacheDir, file), join(out, "models", releaseId, file));
}
writeFileSync(
  join(out, "models", "MODEL_INFO.json"),
  `${JSON.stringify({ model: releaseId, revision: release.revision, upstream: release.upstream, upstreamRevision: release.upstreamRevision, license: release.license, files: release.files, onnxRuntime: ORT_FILES }, null, 2)}
`,
);

for (const size of [16, 32, 48, 128]) writeFileSync(join(out, "icons", `icon-${size}.png`), lensIcon(size));

console.log(`Built X Feed Lens ${pkg.version} → ${out}`);

function fail(message) {
  console.error(`Build failed: ${message}`);
  process.exit(1);
}

async function sha256(path) {
  const h = createHash("sha256");
  await pipeline(createReadStream(path), h);
  return h.digest("hex");
}

// --- Deterministic PNG icon (blue disc with a white magnifier), no image dependencies. ---
function lensIcon(size) {
  const ss = 4; // supersampling
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let disc = 0;
      let glyph = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          const dc = Math.hypot(u - 0.5, v - 0.5);
          if (dc <= 0.5) disc++;
          const dr = Math.hypot(u - 0.44, v - 0.44);
          const ring = dr >= 0.15 && dr <= 0.23;
          // handle: segment from (0.6,0.6) to (0.76,0.76), width 0.09
          const t = Math.max(0, Math.min(1, ((u - 0.6) + (v - 0.6)) / 0.32));
          const hx = 0.6 + 0.16 * t - u;
          const hy = 0.6 + 0.16 * t - v;
          const handle = Math.hypot(hx, hy) <= 0.055;
          if (dc <= 0.5 && (ring || handle)) glyph++;
        }
      }
      const n = ss * ss;
      const a = disc / n;
      const g = glyph / n / Math.max(a, 1e-6);
      const i = (y * size + x) * 4;
      px[i] = Math.round(29 + (255 - 29) * g);
      px[i + 1] = Math.round(155 + (255 - 155) * g);
      px[i + 2] = Math.round(240 + (255 - 240) * g);
      px[i + 3] = Math.round(255 * a);
    }
  }
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0;
    px.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c;
}
