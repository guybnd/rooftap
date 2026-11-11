import type { createAdminClient } from "@/lib/supabase/admin";

// A tiny in-memory stand-in for the admin client, for the tool tests: the
// filters tool-data.ts uses narrow the rows, update patches the matching
// rows, insert appends. Enough to drive the handlers, privacy rules included.

type Row = Record<string, unknown>;

/** One `col.op.value` part of an or() filter (only eq is used). */
function orPart(r: Row, part: string): boolean {
  const [k, op, ...rest] = part.split(".");
  const v = rest.join(".");
  if (op !== "eq") throw new Error(`fake admin: no or() op ${op}`);
  return String(r[k] ?? (v === "false" ? false : null)) === v;
}

export function fakeAdmin(tables: Record<string, Row[]>) {
  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: { kind: "select" } | { kind: "update"; patch: Row } | { kind: "insert"; row: Row | Row[] } = { kind: "select" };
    let limit = Infinity;
    const rows = () => (tables[table] ??= []).filter((r) => filters.every((f) => f(r))).slice(0, limit);
    const b = {
      select: () => b,
      eq: (k: string, v: unknown) => (
        filters.push((r) =>
          Array.isArray(r[k]) && v === "{}" ? (r[k] as unknown[]).length === 0 : (r[k] ?? (v === false ? false : null)) === v,
        ),
        b
      ),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
      gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), b),
      lte: (k: string, v: string) => (filters.push((r) => String(r[k]) <= v), b),
      lt: (k: string, v: string) => (filters.push((r) => String(r[k]) < v), b),
      ilike: (k: string, v: string) => (filters.push((r) => String(r[k]).toLowerCase() === v.replace(/\\(.)/g, "$1").toLowerCase()), b),
      or: (expr: string) => (filters.push((r) => expr.split(",").some((part) => orPart(r, part))), b),
      not: (k: string, o: string, v: string) => {
        if (o !== "cs") throw new Error(`fake admin: no not() op ${o}`);
        const wanted = v.slice(1, -1).split(",");
        filters.push((r) => !wanted.every((w) => ((r[k] as string[] | null) ?? []).includes(w)));
        return b;
      },
      order: () => b,
      limit: (n: number) => ((limit = n), b),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      update: (patch: Row) => ((op = { kind: "update", patch }), b),
      insert: (row: Row | Row[]) => ((op = { kind: "insert", row }), b),
      then: (resolve: (v: { data: Row[] | null; error: null }) => unknown) => {
        if (op.kind === "insert") (tables[table] ??= []).push(...(Array.isArray(op.row) ? op.row : [op.row]));
        if (op.kind === "update") for (const r of rows()) Object.assign(r, (op as { patch: Row }).patch);
        return Promise.resolve({ data: op.kind === "select" ? rows() : null, error: null }).then(resolve);
      },
    };
    return b;
  }
  return { from: builder } as unknown as ReturnType<typeof createAdminClient>;
}
