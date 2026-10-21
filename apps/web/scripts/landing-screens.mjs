// Shoots the landing page's app screens from the screen demo
// (landing-static/demo): builds it, serves the build, opens every scene at
// phone size in Chromium and writes public/landing/screens/<scene>.webp.
// The landing page shows these, so they are the real app, not a drawing.
//
//   npm run landing:screens -w apps/web            every scene
//   npm run landing:screens -w apps/web -- home    one scene
//
// Needs Playwright with Chromium (`npx playwright install chromium`, or set
// PLAYWRIGHT_MODULE to an installed playwright package).
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const web = resolve(here, "..");
const dist = join(web, "landing-static/demo/dist");
const out = join(web, "public/landing/screens");
// Where the marks (the rects of the things the stories tap) go, for the page to read.
const marksFile = join(web, "src/components/landing/screen-marks.json");
const only = process.argv.slice(2);

// The device the screens are shot on: a 390 pt phone at 2x.
const VIEWPORT = { width: 390, height: 844 };
const SCALE = 2;

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright", "/opt/node-tools/node_modules/playwright/index.mjs"].filter(Boolean);
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

// sharp ships with Next, so the shots can be WebP without another dependency.
async function toWebp(png) {
  const sharp = (await import("sharp")).default;
  return sharp(png).webp({ quality: 90 }).toBuffer();
}

async function act(page, action) {
  if ("click" in action) await page.locator(action.click).first().click({ timeout: 5000 });
  else if ("tap" in action) await page.mouse.click(action.tap[0], action.tap[1]);
  else if ("drag" in action) {
    // A finger drag on an element: [selector, dx, dy, hold]. With hold, the
    // finger stays down so the screenshot shows the swipe mid-way.
    const [sel, dx, dy, hold] = action.drag;
    const box = await page.locator(sel).first().boundingBox();
    if (!box) throw new Error(`drag: ${sel} not found`);
    const x = box.x + box.width * 0.4;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(x + (dx * i) / 12, y + (dy * i) / 12);
    if (!hold) await page.mouse.up();
  }
  else if ("fill" in action) await page.locator(action.fill).first().fill(action.value);
  else if ("scroll" in action)
    await page.evaluate((n) => {
      // The app scrolls its main pane, not the window, so scroll whatever scrolls.
      const all = [document.scrollingElement, ...document.querySelectorAll("*")];
      for (const el of all) {
        if (el && el.scrollHeight > el.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollBy(0, n);
      }
    }, action.scroll);
  else if ("wait" in action) await page.waitForTimeout(action.wait);
}

/** Marks recorded for a mark's row carry this suffix (story-player.tsx reads them). */
const ROW_SUFFIX = "@row";

/**
 * Runs in the page: the rect of the row or card around an element, or null.
 * That is the nearest wide ancestor that is a list item, has its own fill or
 * border with rounding, or sits beside other wide rows in its parent.
 */
function rowRect(el) {
  const min = window.innerWidth * 0.8;
  const wide = (node) => node.getBoundingClientRect().width >= min;
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    if (!wide(node)) continue;
    const cs = getComputedStyle(node);
    const filled = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
    const bordered = parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderBottomWidth) > 0;
    const rounded = parseFloat(cs.borderTopLeftRadius) > 0;
    const listItem = /list-item/.test(node.className?.toString?.() ?? "");
    const inList = [...(node.parentElement?.children ?? [])].filter(wide).length > 1;
    if (listItem || ((filled || bordered) && rounded) || inList) {
      const r = node.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    }
  }
  return null;
}

async function main() {
  build();
  const { chromium } = await loadPlaywright();
  const { server, port } = await serve();
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: "dark", isMobile: true, hasTouch: true, locale: "en-AU", timezoneId: "Australia/Melbourne" });
  // Every shot is taken on this week's Monday at 2 PM in the household's time
  // zone, so the weather, the countdowns and how many days are left before
  // Saturday (and so where each row sits, which the marks record) are the same
  // whenever the script runs.
  const zone = "Australia/Melbourne";
  const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date()) + "T12:00:00Z");
  today.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  const monday = today.toISOString().slice(0, 10);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(today).find((p) => p.type === "timeZoneName").value.replace("GMT", "") || "+00:00";
  await context.clock.setFixedTime(new Date(`${monday}T14:00:00${offset}`));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  // The scene list lives in the page.
  await page.goto(`http://127.0.0.1:${port}/?scene=__list`, { waitUntil: "networkidle" });
  const scenes = await page.evaluate(() => window.__demo?.scenes ?? []);
  const wanted = only.length ? scenes.filter((s) => only.includes(s)) : scenes;
  if (!wanted.length) throw new Error(`no scenes match ${only.join(", ")}`);
  const marks = existsSync(marksFile) ? JSON.parse(readFileSync(marksFile, "utf8")) : {};

  for (const id of wanted) {
    errors.length = 0;
    await page.goto(`http://127.0.0.1:${port}/?scene=${encodeURIComponent(id)}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const actions = await page.evaluate(() => window.__demo?.actions ?? []);
    for (const a of actions) {
      try {
        await act(page, a);
      } catch (e) {
        errors.push(`action ${JSON.stringify(a)} failed: ${String(e.message).split("\n")[0]}`);
        break;
      }
    }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const png = await page.screenshot({ type: "png" });
    writeFileSync(join(out, `${id}.webp`), await toWebp(png));
    // Measure the marks: the rects of what the story taps or points at, in CSS px.
    const wantedMarks = await page.evaluate(() => window.__demo?.marks ?? {});
    const found = {};
    for (const [name, mark] of Object.entries(wantedMarks)) {
      // A mark is a selector, or [selector, n] for the element's nth ancestor
      // (the card around a line of text, say).
      const [sel, up = 0] = Array.isArray(mark) ? mark : [mark, 0];
      let loc = page.locator(sel).first();
      for (let i = 0; i < up; i++) loc = loc.locator("xpath=..");
      const box = await loc.boundingBox().catch(() => null);
      if (box) found[name] = [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
      else errors.push(`mark ${name} (${sel}) not found`);
      // The row or card the mark sits in, for a story that rings the whole
      // row: the nearest wide ancestor with its own fill, border or rounding.
      const row = box && (await loc.evaluate(rowRect).catch(() => null));
      if (row) found[`${name}${ROW_SUFFIX}`] = row;
    }
    if (Object.keys(wantedMarks).length) marks[id] = found;
    else delete marks[id];
    console.log(`${id}${errors.length ? `  (page errors: ${errors.join(" | ").slice(0, 300)})` : ""}`);
  }

  writeFileSync(marksFile, JSON.stringify(marks, null, 2) + "\n");
  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
