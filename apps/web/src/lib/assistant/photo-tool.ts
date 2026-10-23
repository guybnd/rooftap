import type { SupabaseClient } from "@supabase/supabase-js";
import { FILE_PHOTO_TOOL, toolGate, type TrustLevel } from "@homeup/core";
import type { AssistantTool } from "./tools";
import { photoBytes } from "./photos";

// The Assistant's way to keep a chat photo: it files a copy in Documents
// (receipts, warranties, letters), which stays after the chat photo is
// deleted at the end of the household's keep time. It follows the trust
// level for Documents. The copy goes to the documents bucket in Supabase
// Storage; the apps read either store (core signedDocumentUrl).

const DOCUMENTS_BUCKET = "documents";

const DOC_TYPES = [
  "receipt",
  "invoice",
  "warranty",
  "manual",
  "contract",
  "photo",
  "id_personal",
  "insurance",
  "lease_contract",
  "tax_financial",
  "medical",
  "vehicle",
  "appliance_manual",
  "other",
] as const;

function fail(error: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error }) }], isError: true };
}

export function photoTool(admin: SupabaseClient, userId: string, groupId: string, trust: TrustLevel): AssistantTool | null {
  const gate = toolGate("write", trust);
  if (gate === "hidden") return null;
  return {
    name: FILE_PHOTO_TOOL,
    description:
      "Documents: file a photo the person sent in this chat, so it is kept after chat photos are deleted. " +
      "`photo` is the path from the [sent a photo: ...] note on their message. Give it a short title (\"Dishwasher receipt, Harvey Norman\") and the closest type.",
    parameters: {
      type: "object",
      properties: {
        photo: { type: "string", description: "The photo's path, from the [sent a photo: ...] note." },
        title: { type: "string", minLength: 1, maxLength: 120 },
        doc_type: { type: "string", enum: [...DOC_TYPES] },
        expiry_date: { type: "string", description: "YYYY-MM-DD, for a warranty, ID or policy that runs out." },
      },
      required: ["photo", "title", "doc_type"],
    },
    module: "documents",
    gate,
    run: async (args) => {
      const path = typeof args.photo === "string" ? args.photo.trim() : "";
      // Only this household's chat photos.
      if (!path.startsWith(`${groupId}/`) || path.includes("..")) return fail("That isn't a photo from this household's chats.");
      const title = typeof args.title === "string" ? args.title.trim().slice(0, 120) : "";
      if (!title) return fail("A title is needed.");
      const docType = (DOC_TYPES as readonly string[]).includes(String(args.doc_type)) ? String(args.doc_type) : "other";
      const expiry = typeof args.expiry_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.expiry_date) ? args.expiry_date : null;

      const bytes = await photoBytes(admin, path);
      if (!bytes) return fail("That photo is no longer kept.");
      const id = crypto.randomUUID();
      const filename = `${title.replace(/[^\w\- ]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "photo"}.jpg`;
      const storagePath = `${groupId}/${id}/${crypto.randomUUID()}-${filename}`;
      const { error: upErr } = await admin.storage.from(DOCUMENTS_BUCKET).upload(storagePath, bytes, { contentType: "image/jpeg" });
      if (upErr) return fail("Could not copy the photo into Documents.");
      const { error } = await admin.from("documents").insert({
        id,
        group_id: groupId,
        storage_path: storagePath,
        filename,
        mime_type: "image/jpeg",
        size_bytes: bytes.length,
        doc_type: docType,
        title,
        source: "capture",
        expiry_date: expiry,
        uploaded_by: userId,
      });
      if (error) {
        await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
        return fail("Could not save it in Documents.");
      }
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, document: { id, title, doc_type: docType }, link: "/documents" }) }] };
    },
  };
}
