import { NextResponse } from "next/server";
import { AiBlockedError, aiBlockedResponse, recordAiRead, resolveAiKey, type ResolvedAiKey } from "@/lib/ai/access";
import { parseReceiptFromImages } from "@/lib/ai/parser";
import { extractImagesFromPdf } from "@/lib/pdf-server";
import { getSessionUser } from "@/lib/supabase/session";
import { requireModules } from "@/lib/server-modules";

// FLUX-82: parse a purchase receipt/invoice photo into structured fields to
// prefill the Warranties form. Accepts image data URLs directly, or a base64 PDF
// which is rendered to images server-side (reusing the listing-parser pipeline).
export const maxDuration = 60;

export async function POST(request: Request) {
  // Gate this AI-cost endpoint behind a valid session (cookie web, or Bearer
  // native — HOUP-216, same getSessionUser() pattern as /api/calendar/*).
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Only Groceries reads receipts today (.docs/modules.md).
  const off = await requireModules(user.id, "groceries");
  if (off) return off;
  let aiKey: ResolvedAiKey;
  try {
    aiKey = await resolveAiKey(user.id, "receipt");
  } catch (e) {
    if (e instanceof AiBlockedError) return aiBlockedResponse(e);
    throw e;
  }

  const { images, pdf } = await request.json();

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

    const parsed = await parseReceiptFromImages(dataUrls, aiKey);
    await recordAiRead(aiKey);
    return NextResponse.json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Parse failed";
    const status = message.includes("is not configured") ? 500 : 502;
    return NextResponse.json({ error: `Parse failed: ${message}` }, { status });
  }
}
