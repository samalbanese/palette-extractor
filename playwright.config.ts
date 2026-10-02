import { defineConfig } from "@playwright/test";

// Tests get their own ports and never reuse a running server, so a dev server
// left open (or one from another checkout) can never stand in for this one.
// Outside CI, which builds just before the tests, the production preview is
// rebuilt first so it always serves the current source.
const DEV = "http://127.0.0.1:5183";
const PREVIEW = "http://127.0.0.1:4183";
const preview = "npm run preview -- --host 127.0.0.1 --port 4183 --strictPort";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: DEV,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: /stage-(prod|webgl|no-webgl)\.spec\.ts/ },
    {
      name: "stage-prod",
      testMatch: "stage-prod.spec.ts",
      use: { baseURL: PREVIEW },
    },
    {
      name: "stage-webgl",
      testMatch: "stage-webgl.spec.ts",
      use: {
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ],
        },
      },
    },
    {
      name: "stage-no-webgl",
      testMatch: "stage-no-webgl.spec.ts",
      use: {
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          args: ["--disable-webgl", "--disable-webgl2"],
        },
      },
    },
  ],
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5183 --strictPort",
      url: DEV,
      reuseExistingServer: false,
    },
    {
      command: process.env.CI ? preview : `npm run build && ${preview}`,
      url: PREVIEW,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
