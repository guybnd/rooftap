import { NextResponse } from "next/server";
import { ASSISTANT_PHOTO_TYPES, assistantPhotoType } from "@homeup/core";
import { assistantErrorResponse, assistantRequest } from "@/lib/assistant/service";
import { createPhotoSlot } from "@/lib/assistant/photos";

// A one-time upload slot for a photo to send in an Assistant chat. The
// bucket is private with no storage policies, so this slot (under the
// person's household and their own name) is the only way in.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { mimeType?: unknown };
  const mimeType = assistantPhotoType(typeof body.mimeType === "string" ? body.mimeType : null);
  if (!mimeType || !ASSISTANT_PHOTO_TYPES.includes(mimeType)) return assistantErrorResponse(400, "Attach a photo (JPEG, PNG, WebP or GIF).");
  const ctx = await assistantRequest();
  if ("error" in ctx) return ctx.error;
  try {
    return NextResponse.json(await createPhotoSlot(ctx.admin, ctx.groupId, ctx.userId, mimeType));
  } catch (e) {
    console.error("[assistant] photo slot failed", e);
    return assistantErrorResponse(500, "Could not get the photo ready to upload. Try again.");
  }
}
