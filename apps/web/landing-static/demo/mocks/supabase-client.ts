// @/lib/supabase/client for the screen demo. A query chain whose every method
// returns itself; awaiting it resolves the fixture rows of the table that
// `.from()` named (none for a `.single()`), so the pages' own loaders paint
// the seeded household without a server.
import { documents, HOUSEHOLD } from "../fixtures";

// A stored file, drawn as one sheet of paper with the document's title, so a
// preview shows something instead of signing a URL against no server.
function samplePage(path: string): string {
  const doc = documents.find((d) => d.storage_path === path);
  const title = (doc?.title ?? "Document").replace(/[<&>]/g, "");
  const lines = Array.from({ length: 14 }, (_, i) => `<rect x="60" y="${190 + i * 34}" width="${i % 5 === 4 ? 260 : 480}" height="12" rx="6" fill="#d9d4cc"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><rect width="600" height="800" fill="#fbf9f6"/><text x="60" y="120" font-family="system-ui, sans-serif" font-size="30" font-weight="600" fill="#2b2622">${title}</text><text x="60" y="156" font-family="system-ui, sans-serif" font-size="16" fill="#8a8178">Sample file in the demo household</text>${lines}</svg>`;
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

const storage = {
  from: () => ({
    createSignedUrl: async (path: string) => ({ data: { signedUrl: samplePage(path) }, error: null }),
    getPublicUrl: () => ({ data: { publicUrl: "" } }),
    download: async (path: string) => ({ data: await (await fetch(samplePage(path))).blob(), error: null }),
    upload: async (path: string) => ({ data: { path }, error: null }),
    remove: async () => ({ data: [], error: null }),
  }),
};

type Chain = ((...args: unknown[]) => Chain) & Record<string, unknown>;

function chain(table: string | null, single: boolean): Chain {
  const proxy: Chain = new Proxy((() => proxy) as unknown as Chain, {
    get: (_t, prop) => {
      if (prop === "then") {
        const rows = table ? (HOUSEHOLD.tables[table] ?? []) : [];
        const done = Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null, count: rows.length });
        return done.then.bind(done);
      }
      if (prop === "auth") {
        const user = { id: HOUSEHOLD.currentUserId, email: HOUSEHOLD.memberProfiles[HOUSEHOLD.currentUserId]?.email };
        return {
          getUser: async () => ({ data: { user }, error: null }),
          getSession: async () => ({ data: { session: { user } }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        };
      }
      if (prop === "storage") return storage;
      if (prop === "data") return { publicUrl: "", path: "", signedUrl: "" };
      if (prop === "from") return (name: unknown) => chain(typeof name === "string" ? name : table, false);
      if (prop === "single" || prop === "maybeSingle") return () => chain(table, true);
      return proxy;
    },
    apply: () => proxy,
  });
  return proxy;
}

// One client, like the app's own: pages keep it in effect dependencies.
const client = chain(null, false) as unknown as import("@supabase/supabase-js").SupabaseClient;

export function createClient() {
  return client;
}
