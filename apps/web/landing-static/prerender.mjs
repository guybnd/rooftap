// Puts the server-rendered pages into the built HTML (npm run build:landing-static).
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const { render, hues } = await import(here("./dist-ssr/entry-server.mjs"));
const signIn = process.env.VITE_SIGN_IN_URL || null;

for (const page of ["index", "privacy"]) {
  const file = here(`./dist/${page}.html`);
  const html = readFileSync(file, "utf8");
  if (!html.includes("<!--app-->")) throw new Error(`${page}.html has no <!--app--> slot`);
  const out = html
    .replace("<!--app-->", render(page, signIn))
    .replace("</head>", `<style id="section-hues">${hues()}</style></head>`);
  writeFileSync(file, out);
}
rmSync(here("./dist-ssr"), { recursive: true, force: true });
console.log("prerendered index.html and privacy.html");
