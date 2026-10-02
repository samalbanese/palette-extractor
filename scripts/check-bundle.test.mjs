import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { checkBundle } from "./check-bundle.mjs";

const KB = 1024;
const budgets = { firstLoad: 20 * KB, stage: 5 * KB };
// For checks unrelated to the Stage chunk, whose fixtures have none.
const loose = { requireStage: false };

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
    expect(checkBundle(small, budgets, loose).ok).toBe(true);
    const big = makeDist({
      html: entryHtml(),
      manifest: entryManifest(),
      files: { "assets/index-a.js": 25 * KB },
    });
    const result = checkBundle(big, budgets, loose);
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
    const result = checkBundle(dir, budgets, loose);
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
    expect(checkBundle(dir, budgets, loose).ok).toBe(false);
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

  it("ignores attribute-like text inside another attribute's quotes", () => {
    const dir = makeDist({
      html: entryHtml(
        `<script data-note=" type=classic" type="module" src="/assets/extra-b.js"></script>` +
          `<link title='a > b' rel="modulepreload" href="/assets/pre-c.js">`,
      ),
      manifest: entryManifest(),
      files: {
        "assets/index-a.js": 1 * KB,
        "assets/extra-b.js": 8 * KB,
        "assets/pre-c.js": 8 * KB,
      },
    });
    const result = checkBundle(dir, budgets);
    expect(row(result, "first-load JS").files.sort()).toEqual([
      "assets/extra-b.js",
      "assets/index-a.js",
      "assets/pre-c.js",
      "assets/quantize.worker-abc.js",
    ]);
  });

  it("reads type and rel the way browsers do: any case, rel as a token list", () => {
    const dir = makeDist({
      html: entryHtml(
        `<script type="MODULE" src="/assets/extra-b.js"></script>` +
          `<link rel=" MODULEPRELOAD " href="/assets/pre-c.js">` +
          `<link rel="modulepreload prefetch" href="/assets/pre-d.js">`,
      ),
      manifest: entryManifest(),
      files: {
        "assets/index-a.js": 1 * KB,
        "assets/extra-b.js": 1 * KB,
        "assets/pre-c.js": 1 * KB,
        "assets/pre-d.js": 1 * KB,
      },
    });
    expect(
      row(checkBundle(dir, budgets), "first-load JS").files.sort(),
    ).toEqual([
      "assets/extra-b.js",
      "assets/index-a.js",
      "assets/pre-c.js",
      "assets/pre-d.js",
      "assets/quantize.worker-abc.js",
    ]);
  });

  it("fails on an inline module script, whose imports it cannot measure", () => {
    const dir = makeDist({
      html: entryHtml(
        `<script type="module">import "/assets/extra-b.js";</script>`,
      ),
      manifest: entryManifest(),
      files: { "assets/index-a.js": 1 * KB, "assets/extra-b.js": 1 * KB },
    });
    const result = checkBundle(dir, budgets);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toMatch(/inline module script/);
  });

  it("fails on a module the manifest does not list, whose imports it cannot follow", () => {
    const dir = makeDist({
      html: entryHtml(`<script type="module" src="/bootstrap.js"></script>`),
      manifest: entryManifest(),
      files: { "assets/index-a.js": 1 * KB, "bootstrap.js": 1 * KB },
    });
    const result = checkBundle(dir, budgets);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toMatch(
      /bootstrap\.js.*not in the manifest/,
    );
  });

  it("resolves dot segments before looking a file up in the manifest", () => {
    const dir = makeDist({
      html: `<script type="module" src="/assets/../assets/index-a.js"></script>`,
      manifest: entryManifest({
        "src/dep.ts": { file: "assets/dep-e.js", imports: [] },
        "index.html": {
          file: "assets/index-a.js",
          src: "index.html",
          isEntry: true,
          imports: ["src/dep.ts"],
          dynamicImports: [],
        },
      }),
      files: { "assets/index-a.js": 1 * KB, "assets/dep-e.js": 1 * KB },
    });
    const result = checkBundle(dir, budgets);
    expect(result.ok).toBe(true);
    expect(row(result, "first-load JS").files.sort()).toEqual([
      "assets/dep-e.js",
      "assets/index-a.js",
      "assets/quantize.worker-abc.js",
    ]);
  });

  it("stops dot segments at the site root the way a browser does", () => {
    const dir = makeDist({
      html: `<script type="module" src="/assets/../../assets/index-a.js"></script>`,
      manifest: entryManifest(),
      files: { "assets/index-a.js": 1 * KB },
    });
    const result = checkBundle(dir, budgets);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("fails on a module it cannot map to a file in this build", () => {
    for (const src of [
      "/bootstrap.js?/../assets/index-a.js",
      "/assets/index-a.js#x",
      "/assets/index-a.js?",
      "/assets/index-a.js#",
      "https://other.example/../../assets/index-a.js",
      "//other.example/assets/index-a.js",
    ]) {
      const dir = makeDist({
        html: `<script type="module" src="${src}"></script>`,
        manifest: entryManifest(),
        files: { "assets/index-a.js": 1 * KB },
      });
      const result = checkBundle(dir, budgets);
      expect(result.ok, src).toBe(false);
      expect(result.problems.join("\n"), src).toMatch(/cannot be mapped/);
    }
  });

  it("fails on an encoded spelling, which downloads a counted file again", () => {
    const vendor = entryManifest({
      "src/vendor.ts": { file: "assets/vendor-b.js", imports: [] },
      "index.html": {
        file: "assets/index-a.js",
        src: "index.html",
        isEntry: true,
        imports: ["src/vendor.ts"],
        dynamicImports: [],
      },
    });
    for (const extra of [
      `<script type="module" src="/assets/%69ndex-a.js"></script>`,
      `<link rel="modulepreload" href="/assets/%76endor-b.js">`,
    ]) {
      const dir = makeDist({
        html: entryHtml(extra),
        manifest: vendor,
        files: { "assets/index-a.js": 1 * KB, "assets/vendor-b.js": 1 * KB },
      });
      const result = checkBundle(dir, budgets);
      expect(result.ok, extra).toBe(false);
      expect(result.problems.join("\n"), extra).toMatch(/cannot be mapped/);
    }
  });

  it("counts a file loaded twice from the same address once", () => {
    const dir = makeDist({
      html: entryHtml(`<link rel="modulepreload" href="/assets/index-a.js">`),
      manifest: entryManifest(),
      files: { "assets/index-a.js": 1 * KB },
    });
    expect(checkBundle(dir, budgets).problems).toEqual([]);
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
      row(checkBundle(makeDist(base), budgets, loose), "first-load JS").files,
    ).toContain("assets/quantize.worker-abc.js");
    expect(
      checkBundle(makeDist({ ...base, worker: [] }), budgets, loose).ok,
    ).toBe(false);
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
    expect(checkBundle(dir, budgets, loose).ok).toBe(true);
  });

  it("fails when the Stage chunk is missing unless told it is optional", () => {
    const none = makeDist({
      html: entryHtml(),
      manifest: entryManifest(),
      files: { "assets/index-a.js": 2 * KB },
    });
    const strict = checkBundle(none, budgets);
    expect(strict.ok).toBe(false);
    expect(strict.problems).toContain(
      "no lazily loaded Stage chunk (src/components/Stage.tsx) in the manifest",
    );
    const optional = checkBundle(none, budgets, loose);
    expect(row(optional, "Stage chunk").status).toBe("skipped");
    expect(optional.ok).toBe(true);
  });

  const stageDist = ({
    stageSize,
    shared = false,
    eager = false,
    lazyGl = false,
  }) =>
    makeDist({
      html: entryHtml(),
      manifest: entryManifest({
        "index.html": {
          file: "assets/index-a.js",
          isEntry: true,
          imports: [
            ...(shared ? ["_shared.js"] : []),
            ...(eager ? ["src/components/Stage.tsx"] : []),
          ],
          dynamicImports: eager ? [] : ["src/components/Stage.tsx"],
        },
        "_shared.js": { file: "assets/shared-s.js" },
        "src/components/Stage.tsx": {
          file: "assets/Stage-f.js",
          src: "src/components/Stage.tsx",
          isDynamicEntry: !eager,
          imports: ["_shared.js", ...(lazyGl ? [] : ["_gl.js"])],
          dynamicImports: lazyGl ? ["_gl.js"] : [],
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

  it("enforces the Stage budget over its own imports, not shared first-load files", () => {
    expect(
      row(checkBundle(stageDist({ stageSize: 4 * KB }), budgets), "Stage chunk")
        .status,
    ).toBe("fail"); // 4 + 4 shared + 2 gl
    const sharedCounted = checkBundle(
      stageDist({ stageSize: 2 * KB, shared: true }),
      budgets,
    );
    expect(row(sharedCounted, "Stage chunk").files.sort()).toEqual([
      "assets/Stage-f.js",
      "assets/gl-g.js",
    ]);
    expect(row(sharedCounted, "Stage chunk").status).toBe("pass");
    expect(sharedCounted.ok).toBe(true);
  });

  it("counts chunks the Stage loads lazily in its own budget", () => {
    const result = checkBundle(
      stageDist({ stageSize: 2 * KB, shared: true, lazyGl: true }),
      budgets,
    );
    expect(row(result, "Stage chunk").files.sort()).toEqual([
      "assets/Stage-f.js",
      "assets/gl-g.js",
    ]);
  });

  it("fails when the Stage is bundled into the first load", () => {
    const result = checkBundle(
      stageDist({ stageSize: 1 * KB, eager: true }),
      budgets,
    );
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      "the Stage chunk is part of first-load JS; it must stay lazily loaded",
    );
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
