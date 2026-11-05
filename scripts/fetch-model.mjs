// Downloads the pinned encoder assets listed in scripts/models.lock.json into .cache/models
// (outside dist, which every build deletes) and verifies size + SHA-256 of every file.
//
//   node scripts/fetch-model.mjs            → the release model
//   node scripts/fetch-model.mjs --all      → every model in the lock (for evaluation)
//   node scripts/fetch-model.mjs --pin      → fill in missing small-file hashes after a manual review
//
// Downloads come only from https://huggingface.co/<id>/resolve/<pinned revision>/<file>.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, createReadStream, createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Honour HTTPS_PROXY / HTTP_PROXY like curl does (Node's fetch only does so with NODE_USE_ENV_PROXY=1).
if ((process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY) && !process.env.NODE_USE_ENV_PROXY) {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  process.exit(r.status ?? 1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(root, "scripts", "models.lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const args = new Set(process.argv.slice(2));

export function modelDir(id, revision) {
  return join(root, ".cache", "models", revision, id);
}

async function sha256(path) {
  const h = createHash("sha256");
  await pipeline(createReadStream(path), h);
  return h.digest("hex");
}

async function verify(path, spec) {
  if (!existsSync(path)) return "missing";
  if (statSync(path).size !== spec.size) return "size";
  if (spec.sha256 && (await sha256(path)) !== spec.sha256) return "hash";
  return "ok";
}

async function download(url, dest, attempts = 4) {
  // Prefer curl when present: it follows the system proxy settings and resumes partial files.
  const { spawnSync } = await import("node:child_process");
  mkdirSync(dirname(dest), { recursive: true });
  const curl = spawnSync("curl", ["-sSfL", "--retry", "8", "--retry-all-errors", "--connect-timeout", "20", "-C", "-", "-o", `${dest}.part`, url], { stdio: "inherit" });
  if (curl.status === 0) {
    renameSync(`${dest}.part`, dest);
    return;
  }
  if (curl.error === undefined) console.log(`  curl exited with ${curl.status}; falling back to fetch`);
  for (let i = 1; ; i++) {
    try {
      return await downloadOnce(url, dest);
    } catch (e) {
      if (i >= attempts) throw e;
      console.log(`  retry ${i}/${attempts - 1} after: ${e.message}`);
    }
  }
}

async function downloadOnce(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`GET ${url} → HTTP ${res.status}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, dest);
}

let pinned = false;
const ids = args.has("--all") ? Object.keys(lock.models) : [lock.release];
for (const id of ids) {
  const m = lock.models[id];
  const dir = modelDir(id, m.revision);
  for (const [file, spec] of Object.entries(m.files)) {
    const dest = join(dir, file);
    let state = await verify(dest, spec);
    if (state !== "ok") {
      const url = `https://huggingface.co/${id}/resolve/${m.revision}/${file}`;
      console.log(`↓ ${id}/${file} (${(spec.size / 1e6).toFixed(1)} MB)`);
      await download(url, dest);
      state = await verify(dest, spec);
    }
    if (state !== "ok") throw new Error(`${id}/${file}: verification failed (${state}). Refusing to use it.`);
    if (!spec.sha256) {
      const got = await sha256(dest);
      if (!args.has("--pin")) throw new Error(`${id}/${file}: no pinned SHA-256 in the lock (got ${got}); review and rerun with --pin.`);
      spec.sha256 = got;
      pinned = true;
    }
  }
  console.log(`✓ ${id}@${m.revision.slice(0, 7)} verified in ${dir}`);
}
if (pinned) {
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  console.log("Pinned missing hashes in scripts/models.lock.json");
}
