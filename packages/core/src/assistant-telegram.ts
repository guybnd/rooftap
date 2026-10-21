// Rooftap Assistant on Telegram (HOUP-446): the pure parts both the webhook
// route and its tests use. Formatting goes through parseReply, the same
// Markdown subset the apps render, into the small HTML subset Telegram
// accepts (adapted from homeagent's telegramFormat.ts). Commands, link codes
// and the proposal buttons' callback data live here too.

import { parseReply, type ReplySpan } from './assistant-view';

/** How long a link code from Settings stays valid. */
export const TELEGRAM_LINK_CODE_TTL_MINUTES = 10;

/** Telegram rejects messages longer than this. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

// No 0/O or 1/I/L, so a code read off a screen is typed right the first time.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A six-character link code from `random` bytes (one byte per character). */
export function makeLinkCode(random: Uint8Array): string {
  if (random.length < 6) throw new Error('makeLinkCode needs 6 random bytes');
  return Array.from(random.slice(0, 6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** Normalises what someone typed after /start (case, spaces, dashes). */
export function normaliseLinkCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function spanHtml(s: ReplySpan): string {
  const text = escapeHtml(s.text);
  if (s.href) return `<a href="${escapeHtml(s.href).replace(/"/g, '&quot;')}">${text}</a>`;
  if (s.bold) return `<b>${text}</b>`;
  if (s.italic) return `<i>${text}</i>`;
  return text;
}

/** A reply as Telegram HTML (`parse_mode: 'HTML'`): bold, italic, links, bullets and numbers. */
export function replyToTelegramHtml(text: string): string {
  return parseReply(text)
    .map((b) => {
      const body = b.spans.map(spanHtml).join('');
      if (b.type === 'bullet') return `• ${body}`;
      if (b.type === 'number') return `${b.n}. ${body}`;
      return body;
    })
    .join('\n\n')
    .replace(/\n\n(?=(?:• |\d+\. ))/g, '\n');
}

/** Splits text over Telegram's limit at paragraph or line breaks. */
export function splitTelegramMessage(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut < limit / 2) cut = rest.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = limit;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

export type TelegramCommand =
  | { name: 'start'; code: string | null }
  | { name: 'new'; text: string }
  | { name: 'chats' }
  | { name: 'switch'; index: number | null }
  | { name: 'household' }
  | { name: 'unlink' }
  | { name: 'help' };

/**
 * Reads a bot command ("/new", "/switch 2", "/start ABC123", with or without
 * "@botname"). Null for ordinary text and for commands meant for another bot.
 */
export function parseTelegramCommand(text: string, botUsername?: string | null): TelegramCommand | null {
  const m = /^\/([a-z_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  const arg = (m[3] ?? '').trim();
  switch (m[1].toLowerCase()) {
    case 'start':
      return { name: 'start', code: arg ? normaliseLinkCode(arg) : null };
    case 'new':
      return { name: 'new', text: arg };
    case 'chats':
      return { name: 'chats' };
    case 'switch': {
      const n = Number.parseInt(arg, 10);
      return { name: 'switch', index: Number.isFinite(n) && n > 0 ? n : null };
    }
    case 'household':
      return { name: 'household' };
    case 'unlink':
      return { name: 'unlink' };
    case 'help':
      return { name: 'help' };
    default:
      return null;
  }
}

/** True when a group message is addressed to the bot by @username. */
export function mentionsBot(text: string, botUsername: string | null | undefined): boolean {
  if (!botUsername) return false;
  return new RegExp(`(^|\\s)@${botUsername.replace(/[^A-Za-z0-9_]/g, '')}\\b`, 'i').test(text);
}

/** The message with the bot's @username taken out. */
export function stripBotMention(text: string, botUsername: string | null | undefined): string {
  if (!botUsername) return text.trim();
  return text.replace(new RegExp(`(^|\\s)@${botUsername.replace(/[^A-Za-z0-9_]/g, '')}\\b`, 'gi'), ' ').replace(/\s+/g, ' ').trim();
}

// callback_data is capped at 64 bytes: "ok:" plus a uuid is 39.
export interface ProposalCallback {
  decision: 'confirm' | 'decline';
  messageId: string;
}

export function proposalCallbackData(messageId: string, decision: ProposalCallback['decision']): string {
  return `${decision === 'confirm' ? 'ok' : 'no'}:${messageId}`;
}

export function parseProposalCallback(data: string | null | undefined): ProposalCallback | null {
  const m = /^(ok|no):([0-9a-f-]{36})$/i.exec(data ?? '');
  return m ? { decision: m[1] === 'ok' ? 'confirm' : 'decline', messageId: m[2].toLowerCase() } : null;
}

/** The inline buttons under a reply that proposes changes. */
export function proposalKeyboard(messageId: string, count: number) {
  return {
    inline_keyboard: [
      [
        { text: count > 1 ? `Do all ${count}` : 'Do it', callback_data: proposalCallbackData(messageId, 'confirm') },
        { text: 'Not now', callback_data: proposalCallbackData(messageId, 'decline') },
      ],
    ],
  };
}

export const TELEGRAM_HELP =
  'Talk to me like you would in the app.\n\n' +
  '/new <question>: start a new chat\n' +
  '/chats: list your chats\n' +
  '/switch <number>: carry on in one of them\n' +
  '/household: back to the shared household thread\n' +
  '/unlink: disconnect this Telegram account';
