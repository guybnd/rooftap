import { z } from "zod";
import { addDaysISO, folderBreadcrumb, type Document, type DocumentFolder } from "@homeup/core";
import { compact, ok, personToday, toolRegistrar, type HouseholdTool, type HouseholdToolContext } from "../tool-kit";

// Documents: the household's filed papers, found by title, tag or folder.
// Never the file itself or its details.

export function documentsTools(ctx: HouseholdToolContext): HouseholdTool[] {
  const { admin, userId } = ctx;
  const { tools, tool, db } = toolRegistrar(ctx);

  tool(
    "find_documents",
    {
      description:
        "Documents: find the household's filed papers (warranties, receipts, manuals, insurance, leases...) by words in the title, file name, tag or folder, or by type. expiring_within_days lists ones whose expiry date falls in that many days (and ones already expired in the last 30). Gives the title, type, expiry, tags and folder, and a link that opens the folder in the app; never the file itself or its details.",
      inputSchema: {
        query: z.string().optional(),
        doc_type: z
          .enum([
            "invoice",
            "receipt",
            "warranty",
            "manual",
            "contract",
            "photo",
            "other",
            "id_personal",
            "insurance",
            "lease_contract",
            "tax_financial",
            "medical",
            "vehicle",
            "appliance_manual",
          ])
          .optional(),
        expiring_within_days: z.number().int().positive().max(730).optional(),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ query, doc_type, expiring_within_days, limit }) => {
      const [docs, folders, today] = await Promise.all([
        db.rows<Document>("documents"),
        db.rows<DocumentFolder>("document_folders"),
        personToday(admin, userId),
      ]);
      const path = (id: string | null) =>
        folderBreadcrumb(folders, id)
          .map((f) => f.name)
          .join(" / ");
      const needle = query?.trim().toLowerCase();
      const until = expiring_within_days ? addDaysISO(today, expiring_within_days) : null;
      const found = docs
        .filter((d) => !doc_type || d.doc_type === doc_type)
        .filter((d) => !until || (!!d.expiry_date && d.expiry_date <= until && d.expiry_date >= addDaysISO(today, -30)))
        .filter(
          (d) =>
            !needle || [d.title, d.filename, path(d.folder_id), ...(d.tags ?? [])].some((s) => (s ?? "").toLowerCase().includes(needle)),
        )
        .sort((a, b) => (until ? (a.expiry_date ?? "").localeCompare(b.expiry_date ?? "") : b.created_at.localeCompare(a.created_at)));
      return ok({
        total: found.length,
        documents: found.slice(0, limit ?? 20).map((d) =>
          compact({
            id: d.id,
            title: d.title || d.filename,
            type: d.doc_type,
            expiry_date: d.expiry_date,
            expired: d.expiry_date && d.expiry_date < today ? true : null,
            tags: d.tags,
            folder: path(d.folder_id) || null,
            added: d.created_at.slice(0, 10),
            link: d.folder_id ? `/documents?folder=${d.folder_id}` : "/documents",
          }),
        ),
      });
    },
    { total: 0, documents: [] },
  );

  return tools;
}
