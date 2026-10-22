// Shoots the landing page's app screens from the screen demo
// (landing-static/demo): builds it, serves the build, opens every scene at
// phone size in Chromium and writes public/landing/screens/<scene>.webp.
// The landing page shows these, so they are the real app, not a drawing.
//
//   npm run landing:screens -w apps/web            every scene
//   npm run landing:screens -w apps/web -- home    one scene
//   npm run landing:screens -w apps/web -- --desktop   the desktop shots
//   npm run landing:screens -w apps/web -- --eink      the E-Ink wall frame shots
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
const eink = process.argv.includes("--eink");
const desktop = eink || process.argv.includes("--desktop");
const only = process.argv.slice(2).filter((a) => a !== "--desktop" && a !== "--eink");

// The device the screens are shot on: a 390 pt phone at 2x, or with
// --desktop a 1440 x 900 browser window (the wide layout), written as
// desktop-<scene>.webp. The desktop shots carry no marks.
// --eink a 1280 x 800 e-paper tablet in the E-Ink theme, written as
// eink-<scene>.webp, also with no marks.
const VIEWPORT = eink ? { width: 1280, height: 800 } : desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 };
const SCALE = desktop ? 1.5 : 2;
export const DESKTOP_SCENES = ["home", "groceries-aisles", "costs", "tasks"];
export const EINK_SCENES = ["home"];
const PREFIX = eink ? "eink-" : desktop ? "desktop-" : "";

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
 * Runs in the page: what an element paints, not just its layout box. Large
 * display type (the Hero numbers) overflows a tight line box, so the box is
 * widened by every line of text and every icon inside it.
 */
/**
 * Runs in the page: what inks the screen inside `root`, as [node, rect]
 * pairs: each line of text (glyph overhang included), and each icon or image.
 */
function inkParts(root) {
  const parts = [];
  // A line's box is its glyphs' advances; big or italic type inks past that,
  // so each side grows by what the canvas measures for the same font.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const ctx = document.createElement("canvas").getContext("2d");
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (!text || !node.parentElement?.checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) continue;
    const f = getComputedStyle(node.parentElement);
    ctx.font = f.font;
    ctx.letterSpacing = f.letterSpacing === "normal" ? "0px" : f.letterSpacing;
    const m = ctx.measureText(text);
    const left = Math.max(0, m.actualBoundingBoxLeft);
    const right = Math.max(0, m.actualBoundingBoxRight - m.width);
    range.selectNodeContents(node);
    for (const q of range.getClientRects()) parts.push([node, new DOMRect(q.left - left, q.top, q.width + left + right, q.height)]);
  }
  // Icons and pictures, but not a drawing the size of the screen (a map, a backdrop).
  for (const part of root.querySelectorAll("svg, img")) {
    const q = part.getBoundingClientRect();
    if (part.checkVisibility?.({ opacityProperty: true }) && q.width * q.height < window.innerWidth * window.innerHeight * 0.25) parts.push([part, q]);
  }
  return parts.filter(([, q]) => q.width >= 1 && q.height >= 1 && q.bottom > 0 && q.top < window.innerHeight);
}

const isFilled = (cs) => (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") || parseFloat(cs.borderTopWidth) > 0;

/** Runs in the page: the painted bounds of an element, as [left, top, right, bottom]. */
function inkBox(el) {
  // A box with its own fill or border paints all of itself; a bare wrapper
  // paints only what is in it, so it starts empty and the content sets it.
  const cs = getComputedStyle(el);
  const painted = isFilled(cs) || cs.boxShadow !== "none" || ["INPUT", "TEXTAREA", "BUTTON", "IMG", "svg"].includes(el.tagName);
  const box = el.getBoundingClientRect();
  let [l, t, r, b] = painted ? [box.left, box.top, box.right, box.bottom] : [Infinity, Infinity, -Infinity, -Infinity];
  const add = (q) => {
    if (q.width < 1 || q.height < 1) return;
    l = Math.min(l, q.left);
    t = Math.min(t, q.top);
    r = Math.max(r, q.right);
    b = Math.max(b, q.bottom);
  };
  for (const [, q] of inkParts(el)) add(q);
  for (const part of el.querySelectorAll("input, textarea, button, [role=progressbar], [role=meter]")) if (part.checkVisibility?.()) add(part.getBoundingClientRect());
  // Filled or bordered children (chips, meters, cards) paint their whole box.
  for (const child of el.querySelectorAll("*")) if (child.checkVisibility?.() && isFilled(getComputedStyle(child))) add(child.getBoundingClientRect());
  if (l === Infinity) [l, t, r, b] = [box.left, box.top, box.right, box.bottom];
  return [l, t, r, b];
}

/**
 * Runs in the page: where a ring around an element goes, as [x, y, w, h,
 * padLeft, padTop, padRight, padBottom]. The rect is the element's ink; the
 * pads are the room the ring may take on each side (RING_PAD in the story
 * player) and still keep CLEAR from other text and icons. When a neighbour is
 * closer than that, the mark should name the block that holds both.
 */
function ringRect(el) {
  const PAD = 12;
  const CLEAR = 4;
  let [l, t, r, b] = inkBox(el);
  const others = inkParts(document.body)
    .filter(([node]) => !el.contains(node) && !node.contains?.(el))
    .map(([, q]) => q);
  const pads = [PAD, PAD, PAD, PAD];
  for (const q of others) {
    const besideX = q.left < r + PAD && q.right > l - PAD;
    const besideY = q.top < b + PAD && q.bottom > t - PAD;
    if (besideX && q.bottom <= t) pads[1] = Math.min(pads[1], t - q.bottom - CLEAR);
    if (besideX && q.top >= b) pads[3] = Math.min(pads[3], q.top - b - CLEAR);
    if (besideY && q.right <= l) pads[0] = Math.min(pads[0], l - q.right - CLEAR);
    if (besideY && q.left >= r) pads[2] = Math.min(pads[2], q.left - r - CLEAR);
  }
  l = Math.max(0, l);
  t = Math.max(0, t);
  r = Math.min(window.innerWidth, r);
  b = Math.min(window.innerHeight, b);
  return [l, t, r - l, b - t, ...pads.map((p) => Math.max(CLEAR, p))].map(Math.round);
}

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
      return window.__ringRect(node);
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
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: "dark", isMobile: !desktop, hasTouch: !desktop, locale: "en-AU", timezoneId: "Australia/Melbourne" });
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
  // rowRect and the marks measure inside the page.
  await context.addInitScript({ content: `${inkParts}; const isFilled = ${isFilled}; ${inkBox}; ${ringRect}; window.__ringRect = ringRect;` });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  // The scene list lives in the page.
  await page.goto(`http://127.0.0.1:${port}/?scene=__list`, { waitUntil: "networkidle" });
  const scenes = await page.evaluate(() => window.__demo?.scenes ?? []);
  const pool = eink ? scenes.filter((s) => EINK_SCENES.includes(s)) : desktop ? scenes.filter((s) => DESKTOP_SCENES.includes(s)) : scenes;
  const wanted = only.length ? pool.filter((s) => only.includes(s)) : pool;
  if (!wanted.length) throw new Error(`no scenes match ${only.join(", ")}`);
  const marks = existsSync(marksFile) ? JSON.parse(readFileSync(marksFile, "utf8")) : {};

  for (const id of wanted) {
    errors.length = 0;
    await page.goto(`http://127.0.0.1:${port}/?scene=${encodeURIComponent(id)}${eink ? "&theme=e-ink" : ""}`, { waitUntil: "networkidle" });
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
    writeFileSync(join(out, `${PREFIX}${id}.webp`), await toWebp(png));
    if (desktop) {
      console.log(`${PREFIX}${id}${errors.length ? `  (page errors: ${errors.join(" | ").slice(0, 300)})` : ""}`);
      continue;
    }
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
      if (box) found[name] = await loc.evaluate((el) => window.__ringRect(el)).catch(() => [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]);
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

  if (!desktop) writeFileSync(marksFile, JSON.stringify(marks, null, 2) + "\n");
  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
