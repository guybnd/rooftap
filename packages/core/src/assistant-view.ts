// Rooftap Assistant: what both apps' screens show, as pure functions
// (HOUP-443). The chat list's grouping, a conversation's caption, and the
// small Markdown subset replies use (the prompt asks for bold, lists and
// links only), so web and native render the same reply the same way.

import { isConversationOpen } from './assistant';
import type { AssistantConversation } from './assistant-api';
import { MCP_TOOLS } from './mcp-tools';
import { getModule, type ModuleId } from './modules';

/** Modules the assistant has tools for, in tool order, that are switched on. */
export function assistantModules(enabled: ReadonlySet<string>): { id: ModuleId; label: string }[] {
  const ids = [...new Set(MCP_TOOLS.map((t) => t.module))].filter((id) => enabled.has(id));
  return ids.map((id) => ({ id, label: getModule(id)?.label ?? id }));
}

export interface ConversationGroups {
  /** The shared thread, when it has been started. */
  household: AssistantConversation | null;
  /** Chats the person keeps, pinned first, then most recent. */
  chats: AssistantConversation[];
  /** Quick asks still taking follow-ups. */
  open: AssistantConversation[];
  /** Quick asks that have closed, newest first. */
  earlier: AssistantConversation[];
}

/** Splits the chat list into the sections the Assistant screen shows. */
export function groupConversations(conversations: AssistantConversation[], now: Date = new Date()): ConversationGroups {
  const byRecent = (a: AssistantConversation, b: AssistantConversation) => b.last_active_at.localeCompare(a.last_active_at);
  const household = conversations.find((c) => c.kind === 'household') ?? null;
  const chats = conversations
    .filter((c) => c.kind === 'chat')
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || byRecent(a, b));
  const quick = conversations.filter((c) => c.kind === 'quick').sort(byRecent);
  return {
    household,
    chats,
    open: quick.filter((c) => isConversationOpen(c.kind, c.closes_at, now)),
    earlier: quick.filter((c) => !isConversationOpen(c.kind, c.closes_at, now)),
  };
}

/** A conversation's name in lists and headers. */
export function conversationTitle(c: Pick<AssistantConversation, 'kind' | 'title'>): string {
  if (c.kind === 'household') return 'Household';
  return c.title?.trim() || (c.kind === 'quick' ? 'Quick ask' : 'New chat');
}

/** Minutes until a quick ask stops taking follow-ups, or null when it doesn't close. */
export function minutesLeft(c: Pick<AssistantConversation, 'kind' | 'closes_at'>, now: Date = new Date()): number | null {
  if (c.kind !== 'quick' || !c.closes_at) return null;
  return Math.max(0, Math.ceil((new Date(c.closes_at).getTime() - now.getTime()) / 60_000));
}

/** Micro-dollars as a short cost label: "<$0.01", "$0.03". */
export function formatMicros(micros: number): string {
  if (micros <= 0) return '$0.00';
  const dollars = micros / 1_000_000;
  return dollars < 0.01 ? '<$0.01' : `$${dollars.toFixed(2)}`;
}

/** Cents as a dollar label: "$1.20". */
export function formatCents(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

// ── Reply text ──────────────────────────────────────────────────────────

export interface ReplySpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** http(s) links only; anything else stays plain text. */
  href?: string;
}

export interface ReplyBlock {
  type: 'paragraph' | 'bullet' | 'number';
  spans: ReplySpan[];
  /** Position in a numbered list, counted from 1. */
  n?: number;
}

const INLINE = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function inline(text: string): ReplySpan[] {
  const spans: ReplySpan[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) spans.push({ text: text.slice(last, m.index) });
    if (m[1] ?? m[2]) spans.push({ text: (m[1] ?? m[2])!, bold: true });
    else if (m[3] ?? m[4]) spans.push({ text: (m[3] ?? m[4])!, italic: true });
    else spans.push({ text: m[5]!, href: m[6]! });
    last = m.index! + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans;
}

/**
 * Parses a reply into paragraphs and list items with bold, italic and links.
 * Headings lose their hashes and become bold paragraphs; anything else
 * Markdown would do (tables, code) shows as written.
 */
export function parseReply(text: string): ReplyBlock[] {
  const blocks: ReplyBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', spans: inline(paragraph.join('\n')) });
    paragraph = [];
  };
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (bullet) {
      flush();
      blocks.push({ type: 'bullet', spans: inline(bullet[1]) });
    } else if (number) {
      flush();
      const prev = blocks[blocks.length - 1];
      blocks.push({ type: 'number', spans: inline(number[1]), n: prev?.type === 'number' ? prev.n! + 1 : 1 });
    } else if (heading) {
      flush();
      blocks.push({ type: 'paragraph', spans: [{ text: heading[1].replace(/\*\*/g, ''), bold: true }] });
    } else paragraph.push(line);
  }
  flush();
  return blocks;
}
