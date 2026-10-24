// Rooftap Assistant: tagging in the household chat. Typing `@` in the
// composer offers @Rooftap (which asks the Assistant) and the other members
// by first name; the server reads the same tags to tell a tagged member
// "Guy mentioned you" instead of the plain household push.

export interface MentionOption {
  /** What lands in the message after the `@`: `Rooftap` or a member's first name. */
  name: string;
  kind: 'rooftap' | 'member';
  /** The member's user id (members only). */
  userId?: string;
}

/** The `@word` being typed at the caret: where its `@` sits and what follows it. */
export interface MentionDraft {
  start: number;
  query: string;
}

export const ROOFTAP_MENTION: MentionOption = { name: 'Rooftap', kind: 'rooftap' };

/** How many suggestions the composer shows at once. */
export const MAX_MENTION_SUGGESTIONS = 5;

/** A member's first name, the way the server names them in the household thread. */
export function mentionName(profile: { name?: string | null; email?: string | null } | null | undefined): string | null {
  const full = profile?.name?.trim() || profile?.email?.split('@')[0]?.trim() || '';
  const first = full.split(/\s+/)[0] ?? '';
  return first.replace(/[^\p{L}\p{N}_'-]/gu, '') || null;
}

/**
 * Who can be tagged: Rooftap first, then the other members (never the person
 * writing), one entry per name.
 */
export function mentionOptions(
  members: { user_id: string }[],
  profiles: Record<string, { name?: string | null; email?: string | null } | undefined>,
  selfId: string | null | undefined
): MentionOption[] {
  const out: MentionOption[] = [ROOFTAP_MENTION];
  const seen = new Set([ROOFTAP_MENTION.name.toLowerCase()]);
  for (const m of members) {
    if (m.user_id === selfId) continue;
    const name = mentionName(profiles[m.user_id]);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, kind: 'member', userId: m.user_id });
  }
  return out;
}

/**
 * The tag being typed when the caret sits right after `@` plus letters, with
 * the `@` at the start or after a space or punctuation (so an email address
 * isn't a tag). Null when the caret isn't in one.
 */
export function mentionAt(text: string, caret: number = text.length): MentionDraft | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const match = /(^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_'-]{0,30})$/u.exec(before);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
}

/** The options whose name starts with what was typed (any case), Rooftap first. */
export function suggestMentions(options: MentionOption[], query: string, max = MAX_MENTION_SUGGESTIONS): MentionOption[] {
  const q = query.toLowerCase();
  const hits = options.filter((o) => o.name.toLowerCase().startsWith(q));
  // A finished tag (`@Rooftap` typed in full) needs no suggestion.
  if (hits.length === 1 && hits[0].name.toLowerCase() === q) return [];
  return hits.slice(0, max);
}

/** Replaces the tag being typed with the picked one and a space; the caret goes after it. */
export function insertMention(
  text: string,
  draft: MentionDraft,
  caret: number,
  option: MentionOption
): { text: string; caret: number } {
  const end = Math.max(draft.start, Math.min(caret, text.length));
  const rest = text.slice(end);
  const tag = `@${option.name}${rest.startsWith(' ') ? '' : ' '}`;
  const next = text.slice(0, draft.start) + tag + rest;
  return { text: next, caret: draft.start + tag.length + (rest.startsWith(' ') ? 1 : 0) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Which members a message tags by `@FirstName` (any case), from user id to first name. */
export function mentionedMembers(text: string, names: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [userId, name] of names) {
    const tagName = mentionName({ name });
    if (!tagName) continue;
    const tag = new RegExp(`(^|[^\\p{L}\\p{N}_@])@${escapeRegExp(tagName)}(?![\\p{L}\\p{N}_])`, 'iu');
    if (tag.test(text)) out.push(userId);
  }
  return out;
}
