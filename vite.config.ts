/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // The chunk graph lets the bundle budget check follow imports.
    manifest: true,
  },
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "scripts/**/*.test.mjs",
    ],
  },
});
