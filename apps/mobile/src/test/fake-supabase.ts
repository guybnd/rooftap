// A Supabase client for screen tests that serves fixed rows per table. Every
// query builder method chains, and awaiting the query gives the table's rows
// (filters are ignored: a test's rows are already the household's). Writes
// resolve with no error. Realtime channels never deliver.

export type Tables = Record<string, readonly Record<string, unknown>[]>;

const channel: Record<string, unknown> = new Proxy(
  {},
  {
    get: (_t, key) => {
      if (key === 'then') return undefined;
      if (key === 'subscribe') return (cb?: (status: string) => void) => (cb?.('SUBSCRIBED'), channel);
      if (key === 'unsubscribe') return async () => 'ok';
      return () => channel;
    },
  },
);

function builder(rows: readonly Record<string, unknown>[]): unknown {
  const result = { data: rows.map((r) => ({ ...r })), error: null, count: rows.length, status: 200 };
  const self: unknown = new Proxy(function () {}, {
    get: (_t, key) => {
      if (key === 'then') return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(result).then(resolve, reject);
      if (key === 'single' || key === 'maybeSingle') return () => builderOne(rows[0] ?? null);
      return () => self;
    },
  });
  return self;
}

function builderOne(row: Record<string, unknown> | null): unknown {
  const result = { data: row ? { ...row } : null, error: null, status: 200 };
  return { then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(result).then(resolve, reject) };
}

export function fakeSupabase(tables: Tables) {
  return {
    from: (table: string) => builder(tables[table] ?? []),
    rpc: () => builder([]),
    channel: () => channel,
    removeChannel: async () => 'ok',
    removeAllChannels: async () => [],
    getChannels: () => [],
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }), createSignedUrl: async () => ({ data: null, error: null }) }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
  };
}
