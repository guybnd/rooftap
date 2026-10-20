// @/lib/supabase/client for the screen demo. A query chain whose every method
// returns itself; awaiting it resolves the fixture rows of the table that
// `.from()` named (none for a `.single()`), so the pages' own loaders paint
// the seeded household without a server.
import { HOUSEHOLD } from "../fixtures";

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
      if (prop === "data") return { publicUrl: "", path: "", signedUrl: "" };
      if (prop === "from") return (name: unknown) => chain(typeof name === "string" ? name : table, false);
      if (prop === "single" || prop === "maybeSingle") return () => chain(table, true);
      return proxy;
    },
    apply: () => proxy,
  });
  return proxy;
}

export function createClient() {
  return chain(null, false) as unknown as import("@supabase/supabase-js").SupabaseClient;
}
