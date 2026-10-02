// Fails the build when the JavaScript a first visit downloads, or the lazily
// loaded Stage renderer, grows past its gzip budget. Sizes are measured the
// way they travel: each file gzipped on its own.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const DEFAULT_BUDGETS = { firstLoad: 75 * 1024, stage: 15 * 1024 };
const STAGE_SOURCE = "src/components/Stage.tsx";
const WORKER_FILE = /^quantize\.worker-[\w-]+\.js$/;

function tagsOf(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(
    (m) => m[0],
  );
}

// HTML allows double, single or no quotes, and spaces around "=".
function attr(tag, name) {
  const m = tag.match(
    new RegExp(
      `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`,
      "i",
    ),
  );
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

/** One spelling per file: "/assets/a.js" and "./assets/a.js" are "assets/a.js". */
const canonical = (path) => path.replace(/^(?:\.?\/)+/, "");

export function checkBundle(distDir, budgets = DEFAULT_BUDGETS) {
  const problems = [];
  const rows = [];
  const htmlPath = join(distDir, "index.html");
  const manifestPath = join(distDir, ".vite", "manifest.json");
  if (!existsSync(htmlPath)) problems.push("index.html is missing");
  if (!existsSync(manifestPath))
    problems.push(".vite/manifest.json is missing (build.manifest must be on)");
  if (problems.length) return { ok: false, rows, problems };

  const html = readFileSync(htmlPath, "utf8");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const keyOfFile = new Map(
    Object.entries(manifest).map(([key, chunk]) => [
      canonical(chunk.file),
      key,
    ]),
  );
  const closure = (keys) => {
    const files = new Set();
    const seen = new Set();
    const walk = (key) => {
      if (seen.has(key) || !manifest[key]) return;
      seen.add(key);
      files.add(canonical(manifest[key].file));
      for (const next of manifest[key].imports ?? []) walk(next);
    };
    keys.forEach(walk);
    return files;
  };

  const scripts = tagsOf(html, "script")
    .filter((tag) => attr(tag, "type") === "module")
    .map((tag) => attr(tag, "src"))
    .filter(Boolean);
  if (!scripts.length) problems.push("index.html has no module script");
  const preloads = tagsOf(html, "link")
    .filter((tag) => attr(tag, "rel") === "modulepreload")
    .map((tag) => attr(tag, "href"))
    .filter(Boolean);
  const htmlFiles = [...scripts, ...preloads].map(canonical);

  const firstLoad = new Set(htmlFiles);
  for (const file of closure(
    htmlFiles.map((f) => keyOfFile.get(f)).filter(Boolean),
  ))
    firstLoad.add(file);

  const assetsDir = join(distDir, "assets");
  const workers = existsSync(assetsDir)
    ? readdirSync(assetsDir).filter((name) => WORKER_FILE.test(name))
    : [];
  if (workers.length !== 1)
    problems.push(
      `expected exactly one quantize worker file, found ${workers.length}`,
    );
  for (const name of workers) firstLoad.add(`assets/${name}`);

  const measure = (files) => {
    let total = 0;
    for (const file of files) {
      const path = join(distDir, file);
      if (!existsSync(path)) {
        problems.push(`referenced file is missing: ${file}`);
        continue;
      }
      total += gzipSync(readFileSync(path)).length;
    }
    return total;
  };
  const budgetRow = (name, files, limit) => {
    const bytesGzip = measure(files);
    rows.push({
      name,
      files: [...files],
      bytesGzip,
      limit,
      status: bytesGzip > limit ? "fail" : "pass",
    });
  };

  budgetRow("first-load JS", firstLoad, budgets.firstLoad);

  const stageKey = Object.keys(manifest).find(
    (key) => key === STAGE_SOURCE || manifest[key].src === STAGE_SOURCE,
  );
  if (stageKey) {
    const stageFiles = [...closure([stageKey])].filter(
      (file) => !firstLoad.has(file),
    );
    budgetRow("Stage chunk", stageFiles, budgets.stage);
  } else {
    rows.push({
      name: "Stage chunk",
      files: [],
      bytesGzip: 0,
      limit: budgets.stage,
      status: "skipped",
    });
  }

  const ok =
    problems.length === 0 && rows.every((row) => row.status !== "fail");
  return { ok, rows, problems };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { ok, rows, problems } = checkBundle(resolve("dist"));
  const kb = (bytes) => `${(bytes / 1024).toFixed(2)} kB`;
  for (const row of rows) {
    const note =
      row.status === "skipped"
        ? "no Stage chunk yet"
        : `${kb(row.bytesGzip)} of ${kb(row.limit)}`;
    console.log(
      `${row.status.toUpperCase().padEnd(8)}${row.name.padEnd(16)}${note}`,
    );
  }
  for (const problem of problems) console.error(`FAIL    ${problem}`);
  process.exit(ok ? 0 : 1);
}
