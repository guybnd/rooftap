import { NextResponse } from "next/server";
import { assistantErrorResponse, assistantRequest } from "@/lib/assistant/service";
import { loadNotifyPrefs, saveNotifyPrefs } from "@/lib/assistant/reads";

// One person's "it answered" pushes: on or off, and whether they show the text.
export async function GET() {
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  return NextResponse.json({ prefs: await loadNotifyPrefs(ctx.admin, ctx.userId) });
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { replies?: unknown; preview?: unknown };
  const ctx = await assistantRequest({ allowNoAccess: true });
  if ("error" in ctx) return ctx.error;
  const patch: { replies?: boolean; preview?: boolean } = {};
  if (typeof body.replies === "boolean") patch.replies = body.replies;
  if (typeof body.preview === "boolean") patch.preview = body.preview;
  try {
    return NextResponse.json({ prefs: await saveNotifyPrefs(ctx.admin, ctx.userId, patch) });
  } catch (err) {
    return assistantErrorResponse(500, err instanceof Error ? err.message : "Could not save that.");
  }
}
