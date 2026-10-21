import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TELEGRAM_HELP,
  TELEGRAM_LINK_CODE_TTL_MINUTES,
  conversationTitle,
  makeLinkCode,
  mentionsBot,
  parseProposalCallback,
  parseTelegramCommand,
  proposalKeyboard,
  replyToTelegramHtml,
  splitTelegramMessage,
  stripBotMention,
  type AssistantMessage,
  type ConversationKind,
} from "@homeup/core";
import { resolveServerKey } from "@/lib/admin-config";
import { assistantContextFor, decideProposal, listConversations, runChat, type AssistantContext } from "./service";

// HOUP-446: the assistant on Telegram. One bot per server: hosted Rooftap
// runs a shared bot through the webhook route; a self-hosted server uses its
// operator's bot, either by webhook or through the `telegram` compose
// profile's poller (scripts/telegram-poller.mjs), which hands each update to
// the same route, so there is one code path. Members link their Telegram
// account with a one-time code from Settings > Assistant; the bot then acts
// as that person, with their private items, trust and allowance. Private
// messages go to the household thread unless the person switched to one of
// their chats; in a group the bot answers when mentioned or replied to, in
// the household thread. Every message is stored like any other, so the
// conversation shows in the app too.

export interface TelegramConfig {
  token: string;
  /** Shared with Telegram (setWebhook secret_token) or the poller; checked on every update. */
  secret: string;
  username: string | null;
}

let cachedUsername: { token: string; username: string | null } | null = null;

/** The bot this server runs, or null when no token and secret are set. */
export async function telegramConfig(lookup = resolveServerKey, api?: TelegramApi): Promise<TelegramConfig | null> {
  const token = (await lookup("TELEGRAM_BOT_TOKEN"))?.trim();
  const secret = (await lookup("TELEGRAM_WEBHOOK_SECRET"))?.trim();
  if (!token || !secret) return null;
  let username = (await lookup("TELEGRAM_BOT_USERNAME"))?.trim().replace(/^@/, "") || null;
  if (!username) {
    if (cachedUsername?.token === token) username = cachedUsername.username;
    else {
      const me = await (api ?? telegramApi(token)).call<{ username?: string }>("getMe", {}).catch(() => null);
      username = me?.username ?? null;
      cachedUsername = { token, username };
    }
  }
  return { token, secret, username };
}

export interface TelegramApi {
  call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T>;
}

export function telegramApi(token: string, fetchImpl: typeof fetch = fetch): TelegramApi {
  return {
    async call<T>(method: string, body: Record<string, unknown>) {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
      if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
      return json.result as T;
    },
  };
}

// ── Updates (the subset the bot reads) ───────────────────────────────────

interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
}
interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  voice?: unknown;
  photo?: unknown;
  reply_to_message?: { from?: TgUser };
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: { message_id: number; chat: TgChat } };
}

interface LinkRow {
  user_id: string;
  group_id: string;
  telegram_user_id: number;
  telegram_username: string | null;
  private_chat_id: number | null;
  conversation_id: string | null;
}

export interface TelegramDeps {
  admin: SupabaseClient;
  api: TelegramApi;
  username: string | null;
  /** Injected in tests; defaults to the real turn. */
  run?: typeof runChat;
  now?: Date;
}

async function send(api: TelegramApi, chatId: number, html: string, extra: Record<string, unknown> = {}) {
  const parts = splitTelegramMessage(html);
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    await api
      .call("sendMessage", { chat_id: chatId, text: parts[i], parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(last ? extra : {}) })
      .catch(async () => {
        // If Telegram rejects the HTML, the plain text still gets through.
        await api.call("sendMessage", { chat_id: chatId, text: parts[i].replace(/<[^>]+>/g, ""), ...(last ? extra : {}) });
      });
  }
}

const NOT_LINKED =
  "Hi! I'm the Rooftap assistant. To talk to me, open Rooftap, go to Settings > Assistant > Telegram and tap Link Telegram. It gives you a code to send me here.";

const ERROR_TEXT: Record<string, string> = {
  assistant_requires_plus: "The assistant comes with Rooftap Plus.",
  assistant_not_configured: "No AI model is set up on this Rooftap server yet.",
  assistant_budget_reached: "This month's assistant budget is used up. An owner can raise it in Settings > Assistant.",
};

/** Handles one Telegram update. Never throws for a bad update: Telegram would only retry it. */
export async function handleTelegramUpdate(update: TgUpdate, deps: TelegramDeps): Promise<void> {
  const { admin } = deps;
  // Telegram retries a webhook that didn't answer in time; answer each update once.
  const { error: seen } = await admin.from("assistant_telegram_updates").insert({ update_id: update.update_id });
  if (seen) return;

  if (update.callback_query) return handleCallback(update.callback_query, deps);
  const msg = update.message;
  if (!msg?.from || msg.chat.type === "channel") return;

  const isPrivate = msg.chat.type === "private";
  const text = msg.text?.trim() ?? "";
  const command = text ? parseTelegramCommand(text, deps.username) : null;
  const addressed =
    isPrivate ||
    !!command ||
    mentionsBot(text, deps.username) ||
    (!!deps.username && msg.reply_to_message?.from?.username?.toLowerCase() === deps.username.toLowerCase());
  if (!addressed) return;

  if (command?.name === "start" && command.code) return linkAccount(msg, command.code, deps);

  const link = await findLink(admin, msg.from.id);
  if (!link) {
    if (isPrivate || command) await send(deps.api, msg.chat.id, NOT_LINKED);
    return;
  }
  const ctx = await assistantContextFor(admin, link.user_id);
  if ("error" in ctx) {
    await send(deps.api, msg.chat.id, "The assistant isn't switched on for your household. An owner can turn it on in Settings > Modules.");
    return;
  }
  if (ctx.access === "none") {
    await send(deps.api, msg.chat.id, ERROR_TEXT.assistant_requires_plus);
    return;
  }

  if (command && command.name !== "new") return runCommand(command, msg, link, ctx, deps);
  if (!text && !command) {
    await send(deps.api, msg.chat.id, msg.voice ? "I can only read text messages for now." : "Send me a message in words and I'll help.");
    return;
  }

  const body = command?.name === "new" ? command.text : isPrivate ? text : stripBotMention(text, deps.username);
  if (!body) {
    await send(deps.api, msg.chat.id, command?.name === "new" ? "Send /new with your question, like /new plan the week." : "Yes?");
    return;
  }
  // Groups always talk in the household thread; private chats follow the person's choice.
  const target: { conversationId: string | null; kind: ConversationKind } =
    command?.name === "new"
      ? { conversationId: null, kind: "chat" }
      : isPrivate && link.conversation_id
        ? { conversationId: link.conversation_id, kind: "chat" }
        : { conversationId: null, kind: "household" };
  await converse(msg.chat.id, body, target, link, ctx, deps, isPrivate);
}

async function findLink(admin: SupabaseClient, telegramUserId: number): Promise<LinkRow | null> {
  const { data } = await admin.from("assistant_telegram_links").select("*").eq("telegram_user_id", telegramUserId).maybeSingle();
  return (data as LinkRow | null) ?? null;
}

async function linkAccount(msg: TgMessage, code: string, deps: TelegramDeps) {
  const { admin, api } = deps;
  const now = deps.now ?? new Date();
  if (msg.chat.type !== "private") {
    await send(api, msg.chat.id, "Send your link code to me in a private chat, not in a group.");
    return;
  }
  const { data } = await admin.from("assistant_telegram_codes").select("*").eq("code", code).maybeSingle();
  const row = data as { code: string; user_id: string; group_id: string; expires_at: string } | null;
  if (!row || new Date(row.expires_at) <= now) {
    await send(api, msg.chat.id, "That code didn't work or has expired. Make a new one in Settings > Assistant > Telegram.");
    return;
  }
  await admin.from("assistant_telegram_codes").delete().eq("user_id", row.user_id);
  // One Telegram account per member and one member per Telegram account.
  await admin.from("assistant_telegram_links").delete().eq("telegram_user_id", msg.from!.id);
  const { error } = await admin.from("assistant_telegram_links").upsert(
    {
      user_id: row.user_id,
      group_id: row.group_id,
      telegram_user_id: msg.from!.id,
      telegram_username: msg.from!.username ?? null,
      private_chat_id: msg.chat.id,
      conversation_id: null,
    },
    { onConflict: "user_id" }
  );
  if (error) {
    await send(api, msg.chat.id, "Something went wrong linking your account. Try again in a moment.");
    return;
  }
  await send(
    api,
    msg.chat.id,
    "You're linked. Ask me anything about the home: tasks, the calendar, the budget, groceries, recipes or your lists. I'll ask before I change anything.\n\n" +
      "Messages here go to the household thread, which everyone at home shares. " +
      TELEGRAM_HELP.split("\n\n")[1]
  );
}

async function runCommand(
  command: NonNullable<ReturnType<typeof parseTelegramCommand>>,
  msg: TgMessage,
  link: LinkRow,
  ctx: AssistantContext,
  deps: TelegramDeps
) {
  const { admin, api } = deps;
  const chatId = msg.chat.id;
  const chats = async () => (await listConversations(ctx)).filter((c) => c.kind === "chat").slice(0, 9);
  switch (command.name) {
    case "start":
    case "help":
      await send(api, chatId, TELEGRAM_HELP);
      return;
    case "household":
      await admin.from("assistant_telegram_links").update({ conversation_id: null }).eq("user_id", link.user_id);
      await send(api, chatId, "Back in the household thread.");
      return;
    case "chats": {
      const list = await chats();
      await send(
        api,
        chatId,
        list.length
          ? `Your chats:\n${list.map((c, i) => `${i + 1}. ${c.id === link.conversation_id ? "<b>" : ""}${escape(conversationTitle(c))}${c.id === link.conversation_id ? "</b>" : ""}`).join("\n")}\n\nSend /switch and a number to carry on in one, or /household for the shared thread.`
          : "You have no chats yet. Start one with /new and your question."
      );
      return;
    }
    case "switch": {
      const list = await chats();
      const pick = command.index ? list[command.index - 1] : undefined;
      if (!pick) {
        await send(api, chatId, "Send /chats to see the numbers, then /switch 2 (for example).");
        return;
      }
      await admin.from("assistant_telegram_links").update({ conversation_id: pick.id }).eq("user_id", link.user_id);
      await send(api, chatId, `Now in "${escape(conversationTitle(pick))}".`);
      return;
    }
    case "unlink":
      await admin.from("assistant_telegram_links").delete().eq("user_id", link.user_id);
      await send(api, chatId, "Unlinked. Your conversations stay in Rooftap.");
      return;
    default:
      return;
  }
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function converse(
  chatId: number,
  text: string,
  target: { conversationId: string | null; kind: ConversationKind },
  link: LinkRow,
  ctx: AssistantContext,
  deps: TelegramDeps,
  isPrivate: boolean
) {
  const { admin, api } = deps;
  const run = deps.run ?? runChat;
  await api.call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});

  let out = await run(ctx, { text, conversationId: target.conversationId, kind: target.kind, channel: "telegram" });
  // The chat they'd switched to was deleted or closed: fall back to the household thread.
  if (!out.ok && target.conversationId && (out.status === 404 || out.status === 409)) {
    await admin.from("assistant_telegram_links").update({ conversation_id: null }).eq("user_id", link.user_id);
    out = await run(ctx, { text, conversationId: null, kind: "household", channel: "telegram" });
  }
  if (!out.ok) {
    await send(api, chatId, escape(ERROR_TEXT[out.code ?? ""] ?? out.error));
    return;
  }
  if (isPrivate && target.kind === "chat" && !target.conversationId) {
    await admin.from("assistant_telegram_links").update({ conversation_id: out.conversation.id }).eq("user_id", link.user_id);
  }

  const reply = [...out.messages].reverse().find((m: AssistantMessage) => m.role === "assistant");
  if (!reply) return;
  const pending = reply.proposal?.state === "pending" ? reply.proposal.items : [];
  const html = [
    replyToTelegramHtml(reply.content),
    pending.length ? pending.map((p) => `• ${escape(p.summary)}`).join("\n") : null,
    out.budget === "over" ? "<i>The assistant is over this month's budget.</i>" : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  await send(api, chatId, html || "Done.", pending.length ? { reply_markup: proposalKeyboard(reply.id, pending.length) } : {});
}

async function handleCallback(query: NonNullable<TgUpdate["callback_query"]>, deps: TelegramDeps) {
  const { admin, api } = deps;
  const parsed = parseProposalCallback(query.data);
  const answer = (text: string) => api.call("answerCallbackQuery", { callback_query_id: query.id, text }).catch(() => {});
  if (!parsed) return void (await answer(""));
  const link = await findLink(admin, query.from.id);
  if (!link) return void (await answer("Link your Telegram account in Rooftap first."));
  const ctx = await assistantContextFor(admin, link.user_id);
  if ("error" in ctx || ctx.access === "none") return void (await answer("The assistant isn't available."));

  const out = await decideProposal(ctx, parsed.messageId, parsed.decision);
  if (!out.ok) return void (await answer(out.status === 409 ? "Already decided." : "That change isn't there any more."));
  await answer(parsed.decision === "confirm" ? "Done" : "Not done");
  if (query.message) {
    await api
      .call("editMessageReplyMarkup", { chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: { inline_keyboard: [] } })
      .catch(() => {});
    if (out.outcome) await send(api, query.message.chat.id, escape(out.outcome.content));
  }
}

// ── Linking from the app ─────────────────────────────────────────────────

/** A fresh one-time code for this member, replacing any earlier one. */
export async function createLinkCode(admin: SupabaseClient, userId: string, groupId: string, now = new Date()) {
  await admin.from("assistant_telegram_codes").delete().eq("user_id", userId);
  // Old codes from anyone are dead weight; tidy them while here.
  await admin.from("assistant_telegram_codes").delete().lt("expires_at", now.toISOString());
  const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_CODE_TTL_MINUTES * 60_000).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeLinkCode(randomBytes(6));
    const { error } = await admin.from("assistant_telegram_codes").insert({ code, user_id: userId, group_id: groupId, expires_at: expiresAt });
    if (!error) return { code, expiresAt };
  }
  throw new Error("Could not make a link code");
}
