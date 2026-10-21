import { NextResponse } from "next/server";
import { AiBlockedError, aiBlockedResponse, recordAiRead, resolveAiKey, type ResolvedAiKey } from "@/lib/ai/access";
import { parseRecipeFromImages } from "@/lib/ai/parser";
import { extractImagesFromPdf } from "@/lib/pdf-server";
import { getSessionUser } from "@/lib/supabase/session";
import { requireModules } from "@/lib/server-modules";

// FLUX-202: parse a recipe photo (cookbook page, handwritten card, screenshot)
// into structured fields to prefill the recipe form. Accepts image data URLs
// directly, or a base64 PDF which is rendered to images server-side (reusing
// the listing-parser pipeline).
export const maxDuration = 60;

export async function POST(request: Request) {
  // HOUP-153: getSessionUser() (HOUP-100 pattern) so a mobile Bearer-only
  // request authenticates too — cookie path stays primary/unchanged.
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const off = await requireModules(user.id, "recipes");
  if (off) return off;
  let aiKey: ResolvedAiKey;
  try {
    aiKey = await resolveAiKey(user.id, "recipe");
  } catch (e) {
    if (e instanceof AiBlockedError) return aiBlockedResponse(e);
    throw e;
  }

  const { images, pdf, libraryNames } = await request.json();

  if (!images?.length && !pdf) {
    return NextResponse.json({ error: "An image or PDF is required" }, { status: 400 });
  }

  try {
    let dataUrls: string[] = Array.isArray(images) ? images : [];

    if (!dataUrls.length && pdf) {
      // `pdf` is a base64 string (optionally a data URL); strip any prefix.
      const base64 = String(pdf).replace(/^data:[^;]+;base64,/, "");
      const buf = Buffer.from(base64, "base64");
      const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      dataUrls = await extractImagesFromPdf(arrayBuffer);
      if (!dataUrls.length) {
        return NextResponse.json({ error: "Could not read the PDF." }, { status: 422 });
      }
    }

    // FLUX-205: item-library names (grocery items + prior recipe ingredients),
    // passed through to the Gemini prompt so "item" can snap to our conventions.
    const parsed = await parseRecipeFromImages(dataUrls, Array.isArray(libraryNames) ? libraryNames : [], aiKey);
    await recordAiRead(aiKey);
    return NextResponse.json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Parse failed";
    const status = message.includes("is not configured") ? 500 : 502;
    return NextResponse.json({ error: `Parse failed: ${message}` }, { status });
  }
}
