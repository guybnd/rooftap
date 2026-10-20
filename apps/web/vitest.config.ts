import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // tsconfig.json sets "jsx": "preserve" for Next.js's own compiler; vite's
  // oxc transform needs an explicit override here or import-analysis chokes
  // on untransformed JSX in .tsx test files (data-cache.test.tsx).
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
    // Tests that `await import()` a route or environment.ts pay the cold
    // transform of its whole dependency chain on first import, which passed
    // 5s on the self-hosted Windows runner. Same reasoning as apps/mobile.
    testTimeout: 15000,
  },
});
