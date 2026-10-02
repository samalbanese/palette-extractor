import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { checkBundle } from "./check-bundle.mjs";

const KB = 1024;
const budgets = { firstLoad: 20 * KB, stage: 5 * KB };

/** Random bytes barely compress, so gzip size tracks the requested size. */
function makeDist({
  html,
  manifest,
  files,
  worker = ["quantize.worker-abc.js"],
}) {
  const dir = mkdtempSync(join(tmpdir(), "bundle-"));
  mkdirSync(join(dir, "assets"));
  mkdirSync(join(dir, ".vite"));
  if (html !== null) writeFileSync(join(dir, "index.html"), html);
  if (manifest !== null)
    writeFileSync(
      join(dir, ".vite", "manifest.json"),
      JSON.stringify(manifest),
    );
  for (const [file, size] of Object.entries(files))
    writeFileSync(join(dir, file), randomBytes(size));
  for (const name of worker)
    writeFileSync(join(dir, "assets", name), randomBytes(1 * KB));
  return dir;
}

const entryHtml = (extra = "") =>
  `<script type="module" crossorigin src="/assets/index-a.js"></script>${extra}`;
const entryManifest = (more = {}) => ({
  "index.html": {
    file: "assets/index-a.js",
    src: "index.html",
    isEntry: true,
    imports: [],
    dynamicImports: [],
  },
  ...more,
});
const row = (result, name) => result.rows.find((r) => r.name === name);

describe("checkBundle", () => {
  it("passes an entry under budget and fails one over it", () => {
    const small = makeDist({
      html: entryHtml(),
      manifest: entryManifest(),
      files: { "assets/index-a.js": 10 * KB },
    });
    expect(checkBundle(small, budgets).ok).toBe(true);
    const big = makeDist({
      html: entryHtml(),
      manifest: entryManifest(),
      files: { "assets/index-a.js": 25 * KB },
    });
    const result = checkBundle(big, budgets);
    expect(result.ok).toBe(false);
    expect(row(result, "first-load JS").status).toBe("fail");
    expect(row(result, "first-load JS").bytesGzip).toBeGreaterThan(25 * KB);
  });

  it("counts modulepreload files and static imports, each file once", () => {
    const dir = makeDist({
      html: entryHtml(
        `<link rel="modulepreload" crossorigin href="/assets/vendor-b.js"><link rel="modulepreload" href="/assets/index-a.js">`,
      ),
      manifest: entryManifest({
        "index.html": {
          file: "assets/index-a.js",
          isEntry: true,
          imports: ["_vendor-b.js", "_vendor-b.js"],
        },
        "_vendor-b.js": { file: "assets/vendor-b.js" },
      }),
      files: { "assets/index-a.js": 8 * KB, "assets/vendor-b.js": 8 * KB },
    });
    const result = checkBundle(dir, budgets);
    expect(row(result, "first-load JS").files.sort()).toEqual([
      "assets/index-a.js",
      "assets/quantize.worker-abc.js",
      "assets/vendor-b.js",
    ]);
    expect(result.ok).toBe(true);
  });

  it("fails when only a dependency chunk of the entry grows", () => {
    const dir = makeDist({
      html: entryHtml(),
      manifest: entryManifest({
        "index.html": {
          file: "assets/index-a.js",
          isEntry: true,
          imports: ["_dep.js"],
        },
        "_dep.js": { file: "assets/dep-c.js", imports: ["_deeper.js"] },
        "_deeper.js": { file: "assets/deeper-d.js" },
      }),
      files: {
        "assets/index-a.js": 2 * KB,
        "assets/dep-c.js": 2 * KB,
        "assets/deeper-d.js": 20 * KB,
      },
    });
    expect(checkBundle(dir, budgets).ok).toBe(false);
  });

  it("finds module scripts and preloads whatever quoting their tags use", () => {
    const dir = makeDist({
      html: entryHtml(
        `<script type='module' src='/assets/extra-b.js'></script>` +
          `<link rel=modulepreload href=/assets/pre-c.js>` +
          `<script src = "/assets/spaced-d.js" type = "module"></script>`,
      ),
      manifest: entryManifest(),
      files: {
        "assets/index-a.js": 1 * KB,
        "assets/extra-b.js": 8 * KB,
        "assets/pre-c.js": 8 * KB,
        "assets/spaced-d.js": 8 * KB,
      },
    });
    const result = checkBundle(dir, budgets);
    expect(row(result, "first-load JS").files.sort()).toEqual([
      "assets/extra-b.js",
      "assets/index-a.js",
      "assets/pre-c.js",
      "assets/quantize.worker-abc.js",
      "assets/spaced-d.js",
    ]);
    expect(result.ok).toBe(false);
  });

  it("follows the imports of an entry referenced by a relative path", () => {
    const dir = makeDist({
      html:
        `<script type="module" src="./assets/index-a.js"></script>` +
        `<link rel="modulepreload" href="/assets/index-a.js">`,
      manifest: entryManifest({
        "index.html": {
          file: "assets/index-a.js",
          isEntry: true,
          imports: ["_dep.js"],
        },
        "_dep.js": { file: "assets/dep-c.js" },
      }),
      files: { "assets/index-a.js": 2 * KB, "assets/dep-c.js": 20 * KB },
    });
    const result = checkBundle(dir, budgets);
    expect(row(result, "first-load JS").files.sort()).toEqual([
      "assets/dep-c.js",
      "assets/index-a.js",
      "assets/quantize.worker-abc.js",
    ]);
    expect(result.ok).toBe(false);
  });

  it("counts the startup worker and requires exactly one", () => {
    const base = {
      html: entryHtml(),
      manifest: entryManifest(),
      files: { "assets/index-a.js": 2 * KB },
    };
    expect(
      row(checkBundle(makeDist(base), budgets), "first-load JS").files,
    ).toContain("assets/quantize.worker-abc.js");
    expect(checkBundle(makeDist({ ...base, worker: [] }), budgets).ok).toBe(
      false,
    );
    expect(
      checkBundle(
        makeDist({
          ...base,
          worker: ["quantize.worker-a.js", "quantize.worker-b.js"],
        }),
        budgets,
      ).ok,
    ).toBe(false);
  });

  it("leaves lazily loaded chunks out of first-load JS", () => {
    const dir = makeDist({
      html: entryHtml(),
      manifest: entryManifest({
        "index.html": {
          file: "assets/index-a.js",
          isEntry: true,
          imports: [],
          dynamicImports: ["src/components/ExportPanel.tsx"],
        },
        "src/components/ExportPanel.tsx": {
          file: "assets/ExportPanel-e.js",
          src: "src/components/ExportPanel.tsx",
          isDynamicEntry: true,
        },
      }),
      files: {
        "assets/index-a.js": 2 * KB,
        "assets/ExportPanel-e.js": 30 * KB,
      },
    });
    expect(checkBundle(dir, budgets).ok).toBe(true);
  });

  it("skips the Stage budget until a Stage chunk exists, then enforces it", () => {
    const none = makeDist({
      html: entryHtml(),
      manifest: entryManifest(),
      files: { "assets/index-a.js": 2 * KB },
    });
    const skipped = checkBundle(none, budgets);
    expect(row(skipped, "Stage chunk").status).toBe("skipped");
    expect(skipped.ok).toBe(true);

    const stage = (stageSize, shared) =>
      makeDist({
        html: entryHtml(),
        manifest: entryManifest({
          "index.html": {
            file: "assets/index-a.js",
            isEntry: true,
            imports: shared ? ["_shared.js"] : [],
          },
          "_shared.js": { file: "assets/shared-s.js" },
          "src/components/Stage.tsx": {
            file: "assets/Stage-f.js",
            src: "src/components/Stage.tsx",
            isDynamicEntry: true,
            imports: ["_shared.js", "_gl.js"],
          },
          "_gl.js": { file: "assets/gl-g.js" },
        }),
        files: {
          "assets/index-a.js": 2 * KB,
          "assets/shared-s.js": 4 * KB,
          "assets/Stage-f.js": stageSize,
          "assets/gl-g.js": 2 * KB,
        },
      });
    expect(
      row(checkBundle(stage(4 * KB, false), budgets), "Stage chunk").status,
    ).toBe("fail"); // 4 + 4 shared + 2 gl
    const sharedCounted = checkBundle(stage(2 * KB, true), budgets);
    expect(row(sharedCounted, "Stage chunk").files.sort()).toEqual([
      "assets/Stage-f.js",
      "assets/gl-g.js",
    ]);
    expect(row(sharedCounted, "Stage chunk").status).toBe("pass");
  });

  it("fails on a missing module script, a missing file, or a missing manifest", () => {
    const files = { "assets/index-a.js": 2 * KB };
    expect(
      checkBundle(
        makeDist({
          html: "<p>no scripts</p>",
          manifest: entryManifest(),
          files,
        }),
        budgets,
      ).ok,
    ).toBe(false);
    expect(
      checkBundle(
        makeDist({ html: entryHtml(), manifest: entryManifest(), files: {} }),
        budgets,
      ).ok,
    ).toBe(false);
    expect(
      checkBundle(
        makeDist({ html: entryHtml(), manifest: null, files }),
        budgets,
      ).ok,
    ).toBe(false);
  });
});
