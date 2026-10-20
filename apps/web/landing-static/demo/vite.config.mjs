// Builds the landing page's screen demo: the app's own pages rendered with a
// seeded household and no backend, one scene per URL (?scene=...). The
// screenshot script (scripts/landing-screens.mjs) builds this, opens each
// scene at phone size and saves it under public/landing/screens, so the
// landing page shows the real app and stays in step with it.
//   npm run build:landing-demo -w apps/web   ->  apps/web/landing-static/demo/dist
import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/postcss";
import { defineConfig } from "vite";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const mock = (name) => here(`./mocks/${name}`);

export default defineConfig({
  root: here("."),
  base: "./",
  publicDir: false,
  resolve: {
    alias: [
      // The seams the app's own smoke test (src/app/module-links.test.tsx) swaps.
      { find: "next/navigation", replacement: mock("next-navigation.tsx") },
      { find: "next/link", replacement: here("../next-link.tsx") },
      { find: "next/image", replacement: mock("next-image.tsx") },
      { find: "next/dynamic", replacement: mock("next-dynamic.tsx") },
      { find: /^@\/lib\/data-cache$/, replacement: mock("data-cache.tsx") },
      { find: /^@\/lib\/supabase\/client$/, replacement: mock("supabase-client.ts") },
      { find: /^@\/lib\/legend\/sync-status$/, replacement: mock("sync-status.tsx") },
      { find: /^@\/lib\/use-section$/, replacement: mock("use-section.ts") },
      { find: /^@\/hooks\/use-overdue-task-count$/, replacement: mock("use-overdue-task-count.ts") },
      { find: /^@\/components\/capture\/capture-sheet$/, replacement: mock("capture-sheet.tsx") },
      { find: /^@\/components\/module-picker$/, replacement: mock("module-picker.tsx") },
      { find: "virtual:create-group-store-original", replacement: here("../../../../packages/core/src/data/create-group-store.ts") },
      { find: /^@\//, replacement: here("../../src/") },
    ],
  },
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [tailwind({ base: here("../..") })] } },
  plugins: [
    // Every group store is built by createGroupStore; the mock seeds them from
    // fixtures. Core imports it by relative path, so this swaps the resolved file.
    {
      name: "demo-group-store",
      enforce: "pre",
      resolveId(source, importer) {
        if (importer && importer.includes("/demo/mocks/")) return null;
        if (/(^|\/)create-group-store$/.test(source)) return mock("create-group-store.ts");
        // A plain observable never reports a sync state, so "loaded" is a given.
        if (/(^|\/)use-store-loaded$/.test(source)) return mock("use-store-loaded.ts");
        return null;
      },
    },
  ],
  build: { outDir: here("./dist"), emptyOutDir: true, assetsDir: "assets", chunkSizeWarningLimit: 2000 },
});
