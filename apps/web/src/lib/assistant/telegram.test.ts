import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin-config", () => ({ resolveServerKey: vi.fn() }));
vi.mock("./service", () => ({
  assistantContextFor: vi.fn(),
  decideProposal: vi.fn(),
  listConversations: vi.fn(),
  runChat: vi.fn(),
}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { assistantContextFor, decideProposal, listConversations } from "./service";
import { createLinkCode, handleTelegramUpdate, telegramConfig, type TelegramApi, type TelegramDeps, type TgUpdate } from "./telegram";

// ── A tiny in-memory stand-in for the Supabase tables the bot touches ──

type Row = Record<string, unknown>;

function fakeAdmin(tables: Record<string, Row[]>) {
  const unique: Record<string, string> = {
    assistant_telegram_updates: "update_id",
    assistant_telegram_codes: "code",
    assistant_telegram_links: "user_id",
  };
  const from = (table: string) => {
    tables[table] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    let op: { kind: "select" | "delete" | "update"; patch?: Row } = { kind: "select" };
    const rows = () => tables[table].filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (op.kind === "delete") tables[table] = tables[table].filter((r) => !filters.every((f) => f(r)));
      if (op.kind === "update") rows().forEach((r) => Object.assign(r, op.patch));
      return { data: rows(), error: null };
    };
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      lt: (k: string, v: string) => (filters.push((r) => String(r[k]) < v), q),
      delete: () => ((op = { kind: "delete" }), q),
      update: (patch: Row) => ((op = { kind: "update", patch }), q),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      insert: async (row: Row) => {
        const key = unique[table];
        if (key && tables[table].some((r) => r[key] === row[key])) return { error: { message: "duplicate" } };
        tables[table].push({ ...row });
        return { error: null };
      },
      upsert: async (row: Row, opts: { onConflict: string }) => {
        const existing = tables[table].find((r) => r[opts.onConflict] === row[opts.onConflict]);
        if (existing) Object.assign(existing, row);
        else tables[table].push({ ...row });
        return { error: null };
      },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

function fakeApi() {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const api: TelegramApi = {
    call: async <T,>(method: string, body: Record<string, unknown>) => {
      calls.push({ method, body });
      return {} as T;
    },
  };
  const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.body.text));
  return { api, calls, sent };
}

const ctx = { userId: "u1", groupId: "g1", isOwner: true, access: "unlimited", enabled: new Set(["assistant"]) };
const reply = (over: Record<string, unknown> = {}) => ({
  ok: true as const,
  conversation: { id: "conv-new", kind: "chat" },
  messages: [
    { id: "m-user", role: "user", content: "hi" },
    { id: "0f8fad5b-d9cb-469f-a165-70867728950e", role: "assistant", content: "Hello **there**", proposal: null },
  ],
  budget: "ok",
  ...over,
});

const message = (text: string, over: Partial<NonNullable<TgUpdate["message"]>> = {}, id = 1): TgUpdate => ({
  update_id: id,
  message: { message_id: 10, from: { id: 555, username: "ana" }, chat: { id: 555, type: "private" }, text, ...over },
});

let tables: Record<string, Row[]>;
let tg: ReturnType<typeof fakeApi>;
let run: ReturnType<typeof vi.fn>;
let deps: TelegramDeps;
const linked = () => tables.assistant_telegram_links.push({ user_id: "u1", group_id: "g1", telegram_user_id: 555, conversation_id: null });

beforeEach(() => {
  tables = { assistant_telegram_links: [], assistant_telegram_codes: [], assistant_telegram_updates: [] };
  tg = fakeApi();
  run = vi.fn().mockResolvedValue(reply());
  deps = { admin: fakeAdmin(tables), api: tg.api, username: "RooftapBot", run: run as unknown as TelegramDeps["run"], now: new Date("2026-10-21T12:00:00Z") };
  vi.mocked(assistantContextFor).mockResolvedValue(ctx as never);
});

describe("linking", () => {
  it("links with a valid code in a private chat and uses it once", async () => {
    tables.assistant_telegram_codes.push({ code: "ABC234", user_id: "u1", group_id: "g1", expires_at: "2026-10-21T12:05:00Z" });
    await handleTelegramUpdate(message("/start abc-234"), deps);
    expect(tables.assistant_telegram_links).toMatchObject([{ user_id: "u1", group_id: "g1", telegram_user_id: 555, telegram_username: "ana" }]);
    expect(tables.assistant_telegram_codes).toHaveLength(0);
    expect(tg.sent()[0]).toMatch(/linked/);
  });

  it("refuses expired codes and codes sent in a group", async () => {
    tables.assistant_telegram_codes.push({ code: "ABC234", user_id: "u1", group_id: "g1", expires_at: "2026-10-21T11:59:00Z" });
    await handleTelegramUpdate(message("/start ABC234"), deps);
    await handleTelegramUpdate(message("/start ABC234", { chat: { id: -9, type: "group" } }, 2), deps);
    expect(tables.assistant_telegram_links).toHaveLength(0);
    expect(tg.sent()).toEqual([expect.stringMatching(/expired/), expect.stringMatching(/private chat/)]);
  });

  it("tells an unlinked person how to link", async () => {
    await handleTelegramUpdate(message("hello"), deps);
    expect(tg.sent()[0]).toMatch(/Link Telegram/);
    expect(run).not.toHaveBeenCalled();
  });

  it("makes a fresh code, replacing the member's old one", async () => {
    tables.assistant_telegram_codes.push({ code: "OLD222", user_id: "u1", group_id: "g1", expires_at: "2026-10-21T12:05:00Z" });
    const { code, expiresAt } = await createLinkCode(deps.admin, "u1", "g1", deps.now);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(expiresAt).toBe("2026-10-21T12:10:00.000Z");
    expect(tables.assistant_telegram_codes.map((r) => r.code)).toEqual([code]);
  });
});

describe("conversation", () => {
  it("answers a private message in the household thread, as HTML", async () => {
    linked();
    await handleTelegramUpdate(message("what's on today?"), deps);
    expect(run).toHaveBeenCalledWith(ctx, { text: "what's on today?", conversationId: null, kind: "household", channel: "telegram" });
    expect(tg.sent()).toEqual(["Hello <b>there</b>"]);
  });

  it("answers each update once", async () => {
    linked();
    await handleTelegramUpdate(message("hi"), deps);
    await handleTelegramUpdate(message("hi"), deps);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("starts a chat with /new and keeps talking in it", async () => {
    linked();
    await handleTelegramUpdate(message("/new plan the week"), deps);
    expect(run).toHaveBeenLastCalledWith(ctx, { text: "plan the week", conversationId: null, kind: "chat", channel: "telegram" });
    expect(tables.assistant_telegram_links[0].conversation_id).toBe("conv-new");
    await handleTelegramUpdate(message("and next week?", {}, 2), deps);
    expect(run).toHaveBeenLastCalledWith(ctx, { text: "and next week?", conversationId: "conv-new", kind: "chat", channel: "telegram" });
  });

  it("falls back to the household thread when the chat is gone", async () => {
    linked();
    tables.assistant_telegram_links[0].conversation_id = "gone";
    run.mockResolvedValueOnce({ ok: false, status: 404, error: "Not found" });
    await handleTelegramUpdate(message("hi"), deps);
    expect(run).toHaveBeenLastCalledWith(ctx, { text: "hi", conversationId: null, kind: "household", channel: "telegram" });
    expect(tables.assistant_telegram_links[0].conversation_id).toBeNull();
  });

  it("only speaks in a group when addressed, and strips the mention", async () => {
    linked();
    const group = { chat: { id: -9, type: "group" as const } };
    await handleTelegramUpdate(message("dinner plans anyone?", group), deps);
    expect(run).not.toHaveBeenCalled();
    await handleTelegramUpdate(message("@RooftapBot add milk", group, 2), deps);
    expect(run).toHaveBeenCalledWith(ctx, { text: "add milk", conversationId: null, kind: "household", channel: "telegram" });
  });

  it("puts Do it / Not now buttons under a proposal", async () => {
    linked();
    run.mockResolvedValueOnce(
      reply({
        messages: [
          {
            id: "0f8fad5b-d9cb-469f-a165-70867728950e",
            role: "assistant",
            content: "Shall I?",
            proposal: { state: "pending", items: [{ summary: 'Add "Milk" to Groceries' }] },
          },
        ],
      })
    );
    await handleTelegramUpdate(message("add milk"), deps);
    const last = tg.calls.filter((c) => c.method === "sendMessage").at(-1)!;
    expect(last.body.text).toBe('Shall I?\n\n• Add "Milk" to Groceries');
    expect(last.body.reply_markup).toMatchObject({ inline_keyboard: [[{ text: "Do it", callback_data: "ok:0f8fad5b-d9cb-469f-a165-70867728950e" }, { text: "Not now" }]] });
  });

  it("lists and switches chats", async () => {
    linked();
    vi.mocked(listConversations).mockResolvedValue([
      { id: "h", kind: "household", title: "Household" },
      { id: "c1", kind: "chat", title: "Holiday" },
      { id: "c2", kind: "chat", title: "Bills" },
    ] as never);
    await handleTelegramUpdate(message("/chats"), deps);
    expect(tg.sent()[0]).toMatch(/1\. Holiday\n2\. Bills/);
    await handleTelegramUpdate(message("/switch 2", {}, 2), deps);
    expect(tables.assistant_telegram_links[0].conversation_id).toBe("c2");
  });
});

describe("proposal buttons", () => {
  it("confirms through decideProposal and clears the buttons", async () => {
    linked();
    vi.mocked(decideProposal).mockResolvedValue({ ok: true, message: {}, outcome: { content: "Added Milk." } } as never);
    await handleTelegramUpdate(
      {
        update_id: 7,
        callback_query: { id: "q", from: { id: 555 }, data: "ok:0f8fad5b-d9cb-469f-a165-70867728950e", message: { message_id: 10, chat: { id: 555, type: "private" } } },
      },
      deps
    );
    expect(decideProposal).toHaveBeenCalledWith(ctx, "0f8fad5b-d9cb-469f-a165-70867728950e", "confirm");
    expect(tg.calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "editMessageReplyMarkup", "sendMessage"]);
    expect(tg.sent()).toEqual(["Added Milk."]);
  });
});

describe("telegramConfig", () => {
  it("needs both the token and the secret, and looks up the username", async () => {
    const keys: Record<string, string> = { TELEGRAM_BOT_TOKEN: "t" };
    const lookup = async (k: string) => keys[k];
    expect(await telegramConfig(lookup)).toBeNull();
    keys.TELEGRAM_WEBHOOK_SECRET = "s";
    const api: TelegramApi = { call: async <T,>() => ({ username: "RooftapBot" }) as T };
    expect(await telegramConfig(lookup, api)).toEqual({ token: "t", secret: "s", username: "RooftapBot" });
  });
});
