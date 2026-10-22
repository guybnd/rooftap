// Smoke test for the landing page's live demo (landing-static/demo with
// ?live=1): builds it, serves the build, opens every page people can reach
// and walks the Shopper and Scout taps. It fails on any page error or on a
// page that renders nothing (the black screen a crash leaves).
//
//   npm run smoke:demo -w apps/web
//
// Needs Playwright with Chromium, like landing-screens.mjs.
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const web = resolve(here, "..");
const dist = join(web, "landing-static/demo/dist");

// The pages the live demo can open (landing-static/demo/scenes.tsx LIVE_PAGES).
const PAGES = [
  "/home",
  "/groceries",
  "/groceries/shelf-life",
  "/calendar",
  "/recipes",
  "/costs",
  "/documents",
  "/checklists",
  "/tasks",
  "/shopper",
  "/shopper/w-vacuum",
  "/shopper/scout/scout-tv",
  "/shopper/scout/scout-mw",
  "/rewards",
  "/setup",
  "/homesearch",
  "/assistant",
  "/settings",
];

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright", "playwright-core", "/opt/node-tools/node_modules/playwright-core/index.mjs"].filter(Boolean);
  for (const c of candidates) {
    try {
      return await import(c);
    } catch {
      /* next */
    }
  }
  throw new Error("Playwright not found: npm i -D playwright, or set PLAYWRIGHT_MODULE");
}

function build() {
  const r = spawnSync("npx", ["vite", "build", "--config", "landing-static/demo/vite.config.mjs"], { cwd: web, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" };
function serve() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = join(dist, path === "/" ? "index.html" : path);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
    res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, port: server.address().port })));
}

if (!process.argv.includes("--no-build")) build();
const { chromium } = await loadPlaywright();
const { server, port } = await serve();
const browser = await chromium.launch(existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {});
const failures = [];

async function open(width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?live=1&theme=ember-night`);
  await page.waitForSelector("#root *");
  return { page, errors };
}

/** Moves the demo the way a tapped link does. */
const go = (page, href) =>
  page.evaluate((h) => {
    const a = document.createElement("a");
    a.href = h;
    document.body.append(a);
    a.click();
    a.remove();
  }, href);

async function check(label, page, errors, expectText) {
  await page.waitForTimeout(600);
  const text = (await page.locator("#root").innerText().catch(() => "")).trim();
  if (errors.length) failures.push(`${label}: ${errors.splice(0).join("; ")}`);
  else if (!text) failures.push(`${label}: rendered nothing`);
  else if (expectText && !text.includes(expectText)) failures.push(`${label}: no "${expectText}"`);
  else console.log(`ok  ${label}`);
}

for (const width of [390, 1440]) {
  const { page, errors } = await open(width);
  for (const path of PAGES) {
    await go(page, path);
    await check(`${width} ${path}`, page, errors);
  }

  // Scout: a suggestion chip, then Watch the price on a pick.
  const step = async (label, run, expectText) => {
    try {
      await run();
      await check(`${width} ${label}`, page, errors, expectText);
    } catch (err) {
      failures.push(`${width} ${label}: ${errors.splice(0).join("; ") || err.message.split("\n")[0]}`);
    }
  };
  await go(page, "/shopper/scout/scout-tv");
  await step("scout chip", () => page.getByRole("button", { name: "Any cheaper options?" }).click({ timeout: 5000 }), "This demo has no AI model");
  await go(page, "/shopper/scout/scout-tv");
  await step("scout watch", async () => {
    await page.getByText('Hisense 65" U7 Mini-LED').first().click({ timeout: 5000 });
    await page.getByRole("button", { name: "Watch the price" }).click({ timeout: 5000 });
  });
  await page.close();
}

await browser.close();
server.close();
if (failures.length) {
  console.error(`\n${failures.length} demo smoke failure(s):\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("\nDemo smoke passed.");
