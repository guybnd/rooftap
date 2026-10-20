// FLUX-202 debug harness: run the real parseRecipeFromImages() against a local
// photo, teeing the raw Gemini response so extraction bugs are visible.
//
// Usage:
//   GEMINI_API_KEY=<key from https://aistudio.google.com/apikey> \
//     npx tsx scripts/test-parse-recipe.ts path/to/recipe-photo.jpg
//
// Not wired into npm scripts on purpose — this is a manual debugging tool.

import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { parseRecipeFromImages } from "../src/lib/ai/parser";

const file = process.argv[2];
if (!file) {
  console.error("usage: GEMINI_API_KEY=... npx tsx scripts/test-parse-recipe.ts <photo>");
  process.exit(1);
}

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
};
const mime = MIME[extname(file).toLowerCase()] ?? "image/jpeg";
const dataUrl = `data:${mime};base64,${readFileSync(resolve(file)).toString("base64")}`;
console.log(`image: ${file} (${mime}, ${Math.round(dataUrl.length / 1024)}KB as data URL)`);

// Tee every fetch response so we see Gemini's raw reply before the parser's
// extraction logic (parts[0].text, fence-strip, JSON.parse) touches it.
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await origFetch(input, init);
  const body = await res.clone().text();
  console.log(`\n=== RAW RESPONSE ${res.status} ===`);
  try {
    const json = JSON.parse(body);
    const cand = json?.candidates?.[0];
    const parts = cand?.content?.parts;
    if (Array.isArray(parts)) {
      console.log(`finishReason: ${cand.finishReason}`);
      console.log(`usage: ${JSON.stringify(json.usageMetadata)}`);
      console.log(`parts: ${parts.length}`);
      parts.forEach((p: Record<string, unknown>, i: number) => {
        const text = typeof p.text === "string" ? p.text : "";
        console.log(
          `\n--- part[${i}] keys=[${Object.keys(p).join(",")}] thought=${p.thought ?? false} textLen=${text.length} ---`,
        );
        console.log(text.slice(0, 3000));
      });
    } else {
      console.log(JSON.stringify(json, null, 2).slice(0, 5000));
    }
  } catch {
    console.log(body.slice(0, 4000));
  }
  console.log("=== END RAW ===\n");
  return res;
}) as typeof fetch;

async function main() {
  const parsed = await parseRecipeFromImages([dataUrl]);
  console.log("=== parseRecipeFromImages() result (what the API route returns) ===");
  console.log(JSON.stringify(parsed, null, 2));
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
