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
  },
});
