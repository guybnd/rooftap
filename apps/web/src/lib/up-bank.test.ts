import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { emptyBankLineCopies, insertBankLines, upSignatureValid, upWebhookUrl } from "./up-bank";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("upSignatureValid", () => {
  const body = JSON.stringify({ data: { attributes: { eventType: "PING" } } });
  const secret = "s3cret";
  const good = createHmac("sha256", secret).update(body).digest("hex");

  it("takes Up's HMAC of the raw body", () => {
    expect(upSignatureValid(body, good, secret)).toBe(true);
    expect(upSignatureValid(body, good.toUpperCase(), secret)).toBe(true);
  });
  it("refuses a missing, wrong or other-secret signature", () => {
    expect(upSignatureValid(body, null, secret)).toBe(false);
    expect(upSignatureValid(body, "abc", secret)).toBe(false);
    expect(upSignatureValid(body, good, "other")).toBe(false);
    expect(upSignatureValid(`${body} `, good, secret)).toBe(false);
  });
});

describe("upWebhookUrl", () => {
  it("builds the webhook address on a public https server", () => {
    expect(upWebhookUrl("https://homeup.vercel.app", "abc")).toBe("https://homeup.vercel.app/api/up-bank/webhook/abc");
  });
  it("gives none for a server Up can't reach", () => {
    expect(upWebhookUrl("http://rooftap.example.com", "abc")).toBeNull();
    expect(upWebhookUrl("https://localhost:3000", "abc")).toBeNull();
    expect(upWebhookUrl("https://rooftap.local", "abc")).toBeNull();
    expect(upWebhookUrl("https://192.168.1.20", "abc")).toBeNull();
    expect(upWebhookUrl("not a url", "abc")).toBeNull();
  });
});

describe("emptyBankLineCopies", () => {
  const now = Date.parse("2026-11-04T03:00:00Z");
  const line = (id: string, provider: string | null, created_at: string) => ({ id, provider, created_at });

  it("drops the empty copy and keeps the line with the payment", () => {
    const lines = [
      line("a", "Melbourne Airport", "2026-10-24T21:59:46.032Z"),
      line("b", "Melbourne Airport", "2026-10-24T21:59:46.047Z"),
    ];
    expect(emptyBankLineCopies(lines, new Map([["b", 1]]), now)).toEqual([{ keep: "b", drop: ["a"] }]);
  });
  it("matches payees without minding case or spaces", () => {
    const lines = [line("a", "AAMI", "2026-10-28T06:27:51Z"), line("b", " aami ", "2026-10-28T06:27:52Z")];
    expect(emptyBankLineCopies(lines, new Map([["a", 1]]), now)).toEqual([{ keep: "a", drop: ["b"] }]);
  });
  it("keeps the oldest when every copy is empty", () => {
    const lines = [line("b", "Snag", "2026-10-29T06:07:32.369Z"), line("a", "Snag", "2026-10-29T06:07:32.359Z")];
    expect(emptyBankLineCopies(lines, new Map(), now)).toEqual([{ keep: "a", drop: ["b"] }]);
  });
  it("leaves lines that both have payments, and single lines", () => {
    const lines = [line("a", "Coles", "2026-10-01T00:00:00Z"), line("b", "Coles", "2026-10-02T00:00:00Z"), line("c", "Aldi", "2026-10-02T00:00:00Z")];
    expect(emptyBankLineCopies(lines, new Map([["a", 2], ["b", 1]]), now)).toEqual([]);
  });
  it("waits before dropping a copy a run may still be filing", () => {
    const lines = [line("a", "Lobby", "2026-11-04T02:58:00Z"), line("b", "Lobby", "2026-11-04T02:58:01Z")];
    expect(emptyBankLineCopies(lines, new Map([["a", 1]]), now)).toEqual([]);
  });
});

describe("insertBankLines", () => {
  // A fake cost_items table with the database's uniq_bank_payee_line rule.
  function fakeAdmin(existing: { id: string; group_id: string; provider: string; bank_payee_key: string | null; deleted: boolean }[]) {
    const rows = [...existing];
    let next = 1;
    const insertOne = (line: Record<string, unknown>) => {
      const clash = rows.some((r) => !r.deleted && r.bank_payee_key && r.group_id === line.group_id && r.bank_payee_key === line.bank_payee_key);
      if (clash) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      const row = { id: `new${next++}`, group_id: line.group_id as string, provider: line.provider as string, bank_payee_key: (line.bank_payee_key as string) ?? null, deleted: false };
      rows.push(row);
      return { data: { id: row.id, provider: row.provider }, error: null };
    };
    const admin = {
      from: () => ({
        insert: (input: Record<string, unknown> | Record<string, unknown>[]) => ({
          select: () => {
            if (Array.isArray(input)) {
              if (input.some((l) => rows.some((r) => !r.deleted && r.bank_payee_key === l.bank_payee_key && r.group_id === l.group_id))) {
                return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate" } });
              }
              return Promise.resolve({ data: input.map((l) => insertOne(l).data), error: null });
            }
            return { single: () => Promise.resolve(insertOne(input)) };
          },
        }),
        select: () => {
          const filters: Record<string, unknown> = {};
          const q = {
            eq: (col: string, val: unknown) => {
              filters[col] = val;
              return q;
            },
            maybeSingle: () => {
              const hit = rows.find((r) => Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
              return Promise.resolve({ data: hit ? { id: hit.id, provider: hit.provider } : null, error: null });
            },
          };
          return q;
        },
      }),
    };
    return { admin: admin as unknown as SupabaseClient, rows };
  }

  it("uses the line another run made first for the same payee", async () => {
    const { admin, rows } = fakeAdmin([{ id: "first", group_id: "g", provider: "LUNE FITZROY", bank_payee_key: "LUNE FITZROY", deleted: false }]);
    const made = await insertBankLines(admin, [
      { group_id: "g", name: "Lune Fitzroy", provider: "LUNE FITZROY", bank_payee_key: "LUNE FITZROY" },
      { group_id: "g", name: "Aldi", provider: "ALDI", bank_payee_key: "ALDI" },
    ]);
    expect(made).toEqual([
      { id: "first", provider: "LUNE FITZROY" },
      { id: "new1", provider: "ALDI" },
    ]);
    expect(rows.filter((r) => r.bank_payee_key === "LUNE FITZROY")).toHaveLength(1);
  });

  it("inserts the whole batch when nothing clashes", async () => {
    const { admin } = fakeAdmin([]);
    const made = await insertBankLines(admin, [{ group_id: "g", name: "Aldi", provider: "ALDI", bank_payee_key: "ALDI" }]);
    expect(made).toEqual([{ id: "new1", provider: "ALDI" }]);
  });
});
