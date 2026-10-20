// Builds the landing page as a static site for GitHub Pages (the public
// guybnd/rooftap repo deploys it with .github/workflows/pages.yml):
//   npm run build:landing-static -w apps/web   ->  apps/web/landing-static/dist
// Set VITE_SIGN_IN_URL to the hosted app's /login to show the Sign in buttons,
// and VITE_SITE_URL to the site's address (with a trailing slash) for the
// canonical and link-preview tags. The build prerenders both pages
// (entry-server.tsx, prerender.mjs). public/landing/og.png is the preview image.
import { copyFileSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/postcss";
import { defineConfig } from "vite";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
process.env.VITE_SITE_URL ||= "https://guybnd.github.io/rooftap/";

export default defineConfig({
  root: here("."),
  base: "./",
  publicDir: false,
  resolve: {
    alias: [
      { find: "next/link", replacement: here("./next-link.tsx") },
      { find: /^@\//, replacement: here("../src/") },
    ],
  },
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [tailwind({ base: here("..") })] } },
  plugins: [
    {
      name: "copy-static",
      writeBundle: (options) => {
        if (options.dir !== here("./dist")) return;
        copyFileSync(here("../public/icon.svg"), here("./dist/icon.svg"));
        // The app screens the stories show (public/landing/screens, shot by scripts/landing-screens.mjs).
        cpSync(here("../public/landing"), here("./dist/landing"), { recursive: true });
      },
    },
  ],
  build: {
    outDir: here("./dist"),
    emptyOutDir: true,
    assetsDir: "assets",
    rollupOptions: { input: { index: here("./index.html"), privacy: here("./privacy.html") } },
  },
});
