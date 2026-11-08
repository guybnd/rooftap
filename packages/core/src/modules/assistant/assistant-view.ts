// Rooftap Assistant: what both apps' screens show, as pure functions
// (HOUP-443). The chat list's grouping, a conversation's caption, and the
// small Markdown subset replies use (the prompt asks for bold, lists and
// links only), so web and native render the same reply the same way.

import { isConversationOpen } from './assistant';
import { SHOW_ITEMS_TOOL, type AssistantChange, type AssistantConversation, type AssistantShown, type AssistantStatus } from './assistant-api';
import { timeAgo } from '../../relative-time';
import { MCP_TOOLS } from '../../mcp-tools';
import { getModule, type ModuleId } from '../../modules';
import { ALL_MANIFESTS } from '../../module-manifests';
import { isHouseholdThread, moduleHelper } from '../../module-helpers';

/** Modules the assistant has tools for, in tool order, that are switched on. */
export function assistantModules(enabled: ReadonlySet<string>): { id: ModuleId; label: string; readOnly: boolean }[] {
  const ids = [...new Set(MCP_TOOLS.map((t) => t.module))].filter((id) => enabled.has(id));
  // A module with lookups only (Documents, Home Search) has no trust to set.
  return ids.map((id) => ({ id, label: getModule(id)?.label ?? id, readOnly: !MCP_TOOLS.some((t) => t.module === id && t.kind === 'write') }));
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
  const household = conversations.find((c) => isHouseholdThread(c)) ?? null;
  // Helper chats the household shares sit with the chats.
  const chats = conversations
    .filter((c) => c.kind === 'chat' || (c.kind === 'household' && !!c.helper))
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
export function conversationTitle(c: Pick<AssistantConversation, 'kind' | 'title' | 'helper'>): string {
  if (isHouseholdThread(c)) return 'Household';
  const helper = moduleHelper(c.helper);
  if (helper) return helper.label;
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
  /** http(s) links, or an in-app route such as /shopper/scout/<id>; anything else stays plain text. */
  href?: string;
}

export interface ReplyBlock {
  type: 'paragraph' | 'bullet' | 'number';
  spans: ReplySpan[];
  /** Position in a numbered list, counted from 1. */
  n?: number;
}

// Links: http(s), or an app route (a single leading slash, then a path).
const INLINE = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[a-z][\w\-/]*)\)/g;

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

// Words that open a question or a request for the assistant rather than a
// thing to add ("milk", "call the plumber").
const ASK_OPENERS = new Set([
  'what', "what's", 'whats', 'how', "how's", 'when', "when's", 'where', "where's", 'who', "who's", 'why', 'which',
  'can', 'could', 'should', 'would', 'will', 'do', 'does', 'did', 'is', 'are', 'was', 'were', 'have', 'has', 'am',
  'plan', 'suggest', 'help', 'tell', 'summarise', 'summarize', 'explain', 'compare', 'recommend', 'find',
]);

/**
 * Whether text typed into the + sheet reads as something to ask Rooftap.
 * The sheet then leads with Ask and Enter sends it there; otherwise adding
 * stays first. A guess, so both choices are always on screen.
 */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (t.endsWith('?')) return true;
  const words = t.split(/\s+/);
  return words.length >= 3 && ASK_OPENERS.has(words[0].replace(/[^a-z']/g, ''));
}

/** A reply as one line of plain text, for a notification or banner. */
export function replyPreview(text: string, max = 140): string {
  const plain = parseReply(text)
    .map((b) => b.spans.map((s) => s.text).join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/**
 * A chat row's meta line: "Showing now" in the pop-up's list for the one on
 * show, the Household thread's audience, the time a quick ask stays open, or
 * when it was last active.
 */
export function conversationRowMeta(
  conversation: AssistantConversation | null,
  current = false,
  now: Date = new Date(),
): string | null {
  const kind = conversation?.kind ?? 'household';
  if (current) return 'Showing now';
  if (kind === 'household' && conversation?.helper) return `Shared with the home · ${timeAgo(conversation.last_active_at)}`;
  if (kind === 'household') return 'Everyone in the home';
  const left = conversation ? minutesLeft(conversation, now) : null;
  if (left != null && left > 0) return `Open for ${left} min`;
  return conversation ? timeAgo(conversation.last_active_at) : null;
}

/** The Assistant space's Hero caption: how many chats, and this month's spend. */
export function assistantSpaceCaption(chatCount: number, status: Pick<AssistantStatus, 'spentCents'> | null): string {
  return [`${chatCount} ${chatCount === 1 ? 'chat' : 'chats'}`, status && status.spentCents > 0 ? `${formatCents(status.spentCents)} this month` : null]
    .filter(Boolean)
    .join(' · ');
}

/** How many closed quick asks the pop-up lists; the Assistant space has the rest. */
export const POPUP_EARLIER_SHOWN = 6;

/** The pop-up's chat list: the Household thread with the kept chats, open quick asks, and the latest closed ones. */
export function popupChatSections(groups: ConversationGroups): { label: string; rows: AssistantConversation[] }[] {
  return [
    { label: 'Chats', rows: [...(groups.household ? [groups.household] : []), ...groups.chats] },
    { label: 'Quick asks', rows: groups.open },
    { label: 'Earlier', rows: groups.earlier.slice(0, POPUP_EARLIER_SHOWN) },
  ].filter((section) => section.rows.length > 0);
}

/** The pop-up's header: "Chats" over the list, the conversation's name, or "Ask Rooftap" for a new ask. */
export function popupTitle(showChats: boolean, conversation: AssistantConversation | null, targetId: string, helper?: string | null): string {
  if (showChats) return 'Chats';
  const h = moduleHelper(helper ?? conversation?.helper);
  if (h) return h.label;
  return conversation ? conversationTitle(conversation) : targetId === 'new' ? 'Ask Rooftap' : '';
}

/** An ask the empty Ask sheet offers: the module it belongs to, the sections it touches (by short name) and the words it sends. */
export interface AskStarter {
  module: ModuleId;
  /** The section short names it touches, its own first: "Recipes, Groceries". */
  touches: string;
  text: string;
}

/** Days since the epoch in local time, so the asks change once a day, not on every open. */
function localDay(now: Date): number {
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000);
}

function shortName(id: string): string {
  const m = getModule(id);
  const manifest = ALL_MANIFESTS.find((x) => x.id === id);
  return manifest?.section?.shortLabel ?? m?.label ?? id;
}

/**
 * The empty Ask sheet's suggestions: one ask from each of `count` enabled
 * modules that declare `askStarters` in their manifest, skipping an ask whose
 * `with` modules are off. Which modules, and which of a module's asks, move
 * on each day, so a household with many modules sees them all over a week.
 * Shown in manifest order.
 */
export function askStarters(isEnabled: (id: ModuleId) => boolean, count = 4, now: Date = new Date()): AskStarter[] {
  if (count <= 0) return [];
  const day = localDay(now);
  const offered = ALL_MANIFESTS.flatMap((m) => {
    if (!isEnabled(m.id as ModuleId)) return [];
    const usable = (m.askStarters ?? [])
      .map((d) => (typeof d === 'string' ? { text: d, with: [] as readonly string[] } : d))
      .filter((d) => d.with.every((id) => isEnabled(id as ModuleId)));
    if (usable.length === 0) return [];
    const pick = usable[day % usable.length];
    return [{ module: m.id as ModuleId, touches: [m.id, ...pick.with].map(shortName).join(', '), text: pick.text }];
  });
  const take = Math.min(count, offered.length);
  const start = offered.length > take ? (day * take) % offered.length : 0;
  const picked = new Set(Array.from({ length: take }, (_, i) => (start + i) % offered.length));
  return offered.filter((_, i) => picked.has(i));
}

/** The empty Ask sheet's greeting: by the hour, with the person's first name when there is one. */
export function askGreeting(name: string | null | undefined, now: Date = new Date()): string {
  const h = now.getHours();
  const part = h < 5 ? 'Evening' : h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}.` : `Good ${part.toLowerCase()}.`;
}

/** The pop-up header's second line: what kind of conversation this is and, for a quick ask, how long it stays open. */
export function popupStatus(conversation: AssistantConversation | null, targetId: string, now: Date = new Date(), helper?: string | null): string | null {
  const h = moduleHelper(helper ?? conversation?.helper);
  if (h) return conversation?.kind === 'household' ? 'Shared with the home' : h.subtitle;
  if (!conversation) return targetId === 'new' ? 'New quick ask' : null;
  if (conversation.kind === 'household') return 'Everyone in the home';
  if (conversation.kind === 'chat' || conversation.pinned) return 'Pinned chat';
  const left = minutesLeft(conversation, now);
  return left != null && left > 0 ? `Takes follow-ups for ${left} more min` : 'Closed after a quiet spell';
}

/**
 * What to tell the person when voice input stops with an error (Web Speech
 * error codes, which the phone's recognizer reuses). Null when there is
 * nothing to say: they stopped it, or said nothing.
 */
export function voiceErrorText(code: string): string | null {
  switch (code) {
    case 'aborted':
    case 'no-speech':
    case 'speech-timeout':
      return null;
    case 'not-allowed':
      return 'Rooftap needs the microphone to hear you. Allow it in your settings.';
    case 'service-not-allowed':
    case 'language-not-supported':
      return 'Voice input is not available on this device.';
    case 'network':
      return 'Voice input needs a connection. Try again when you are online.';
    case 'busy':
      return 'The microphone is busy. Try again in a moment.';
    default:
      return 'Could not hear that. Try again.';
  }
}

/** The recognizer's input level (about -2 to 10) as 0 to 1, for the listening meter. */
export function voiceLevel(volume: number): number {
  return Math.max(0, Math.min(1, volume / 10));
}

/**
 * Joins the segments of one spoken ask. A recognizer that listens through
 * pauses (Android's segmented session) reports each phrase on its own: a
 * phrase's partial results, then its final text, then the next phrase from
 * empty. Done phrases are kept here so the words before a pause survive.
 */
export function voiceSegments() {
  let done = '';
  let current = '';
  const join = () => [done, current].filter(Boolean).join(' ');
  return {
    /** A result for the phrase being spoken; `final` closes it. Returns the whole ask so far. */
    add(text: string, final: boolean): string {
      const t = text.trim();
      if (final) {
        if (t) done = done ? `${done} ${t}` : t;
        current = '';
      } else {
        current = t;
      }
      return join();
    },
    text: join,
  };
}

/** How long a pause after a finished phrase ends the ask, and the longest one ask may run. */
export const VOICE_PAUSE_MS = 2200;
export const VOICE_MAX_MS = 60000;
/** How long to wait for any speech before giving up. */
export const VOICE_FIRST_WORDS_MS = 8000;

/** The row kind (GlobalHit.section) each module's changed items draw as; a module not here shows its summary line. */
const CHANGE_ROW: Partial<Record<ModuleId, string>> = {
  household: 'tasks',
  groceries: 'groceries',
  costs: 'costs',
  setup: 'setup',
  recipes: 'recipes',
  checklists: 'checklists',
  shopper: 'shopper',
};

/** The modules whose items a reply can show as rows (show_items). */
export const SHOWABLE_MODULES = Object.keys(CHANGE_ROW) as ModuleId[];

/** A reply's changes by module, in the order they happened, each with what its rows need. */
export interface ChangeGroup {
  /** A stable key for the card. */
  key: string;
  /** Set for items a reply shows (show_items): the group's own title, with no undo or "Added to" caption. */
  title?: string | null;
  module: ModuleId;
  /** The module's short name, e.g. "Tasks". */
  label: string;
  /** Where the module lives, for a change with no row of its own. */
  href: string | null;
  /** The row kind to draw changed items as, or null for summary lines. */
  rowKind: string | null;
  changes: AssistantChange[];
}

export function changeGroups(changes: AssistantChange[] | undefined): ChangeGroup[] {
  const groups: ChangeGroup[] = [];
  for (const change of changes ?? []) {
    const module = change.module as ModuleId;
    let group = groups.find((g) => g.module === module);
    if (!group) {
      const manifest = ALL_MANIFESTS.find((m) => m.id === module);
      group = {
        key: module,
        module,
        label: manifest?.section?.shortLabel ?? manifest?.label ?? 'Rooftap',
        href: manifest?.section?.basePath ?? null,
        rowKind: CHANGE_ROW[module] ?? null,
        changes: [],
      };
      groups.push(group);
    }
    // One entry per item: changing a task twice in a turn shows it once.
    if (change.id && group.changes.some((c) => c.id === change.id)) continue;
    group.changes.push(change);
  }
  return groups;
}

/** How many changed items show in full before the rest fold under "Show all". */
export const CHANGES_SHOWN = 3;

/** How many items a shown group lists before the rest fold under "Show all". */
export const SHOWN_ITEMS_FOLD = 8;

/**
 * The groups a reply shows (show_items), as cards like the changes': each
 * keeps its title, and its ids draw as the items' live rows. Unknown modules
 * and empty groups are left out, and an id shows once per group.
 */
export function shownGroups(shown: AssistantShown[] | undefined): ChangeGroup[] {
  return (shown ?? []).flatMap((s, i) => {
    const module = s.module as ModuleId;
    const rowKind = CHANGE_ROW[module];
    const ids = [...new Set((s.ids ?? []).filter((id) => typeof id === 'string' && id))];
    if (!rowKind || ids.length === 0) return [];
    const manifest = ALL_MANIFESTS.find((m) => m.id === module);
    return [
      {
        key: `shown:${i}`,
        title: s.title?.trim() || manifest?.section?.shortLabel || manifest?.label || 'Items',
        module,
        label: manifest?.section?.shortLabel ?? manifest?.label ?? 'Rooftap',
        href: manifest?.section?.basePath ?? null,
        rowKind,
        changes: ids.map((id) => ({ tool: SHOW_ITEMS_TOOL, module: s.module, verb: 'changed' as const, id, summary: '' })),
      },
    ];
  });
}
