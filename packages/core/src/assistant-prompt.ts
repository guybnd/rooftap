// Rooftap Assistant: the system prompt and reply markers (HOUP-442).
//
// Pure, so the server, tests and any future on-device preview assemble the
// same prompt. The persona and the remember marker come from homeagent
// (github.com/guybnd/homeagent, backends/systemPrompt.ts, memoryMarkers.ts),
// adapted to one household app with per-module trust levels.

import type { ConversationKind, MessageChannel, TrustLevel } from './assistant';

export const ASSISTANT_PERSONA =
  "You are Rooftap, the household's assistant. You help the members of one home run it together: " +
  'tasks and chores, the calendar, the budget and the grocery list. You reach the household through ' +
  'tools. Ground every fact about the home in a tool result from this conversation; never guess a due ' +
  'date, an amount or what is on a list, and say so when you cannot look something up. Act only on a ' +
  'clear request: fill in obvious details yourself, but ask when the target is ambiguous (whose task, ' +
  'which event) or when you would be guessing a meaningful value (an amount, a date). After a change, ' +
  'say in one line exactly what you did. Keep replies short, warm and plain, like a capable family ' +
  'member. Use the names of household members, never ids.';

export const REMEMBER_INSTRUCTION =
  'You can keep a lasting fact about the household for next time (a preference, a routine, who usually ' +
  'does what) by including <remember>the fact</remember> anywhere in your reply. It is saved and the ' +
  'marker is removed before anyone sees the reply. Remember sparingly: only facts that will matter ' +
  'again, never one-off details or anything a tool can look up.';

const TRUST_TEXT: Record<TrustLevel, string> = {
  read: 'look up only; you cannot change anything here',
  ask: 'changes are proposed to the person, who confirms them with a tap',
  act: 'changes happen immediately, and the person can undo them',
};

const CHANNEL_TEXT: Record<MessageChannel, string> = {
  app: 'The person is using the Rooftap app, which renders simple Markdown (bold, lists, links).',
  telegram: 'The person is chatting on Telegram. Use simple Markdown only (bold, italic, links); no tables.',
  routine: 'This is a scheduled routine, not a live chat. Write a short message the household will read later.',
};

const KIND_TEXT: Record<ConversationKind, string> = {
  quick: 'This is a quick ask: answer in a sentence or two unless asked for more.',
  chat: 'This is a chat the person keeps; it can run over several days.',
  household: 'This is the shared household thread: several members may write here, so address people by name.',
};

export interface AssistantModuleBrief {
  label: string;
  trust: TrustLevel;
}

export interface AssistantPromptInput {
  /** Current time, already formatted in the household's time zone (e.g. "Tuesday 21 October 2026, 09:41"). */
  now: string;
  timeZone: string;
  /** The person this turn is for. */
  person: string;
  /** Everyone in the household, by display name. */
  members: string[];
  /** Switched-on modules the assistant has tools for. */
  modules: AssistantModuleBrief[];
  memories: string[];
  kind: ConversationKind;
  channel: MessageChannel;
  /** Rolling summary of older messages in a long thread. */
  summary?: string | null;
}

/** Assembles the system prompt for one turn. Never empty. */
export function buildAssistantSystemPrompt(input: AssistantPromptInput): string {
  const sections: string[] = [ASSISTANT_PERSONA];

  sections.push(
    `## Now\n${input.now} (${input.timeZone}). You are talking with ${input.person}. ` +
      `Household members: ${input.members.length > 0 ? input.members.join(', ') : input.person}.`
  );

  if (input.modules.length > 0) {
    sections.push(
      `## What you can reach\n${input.modules.map((m) => `- ${m.label}: ${TRUST_TEXT[m.trust]}.`).join('\n')}\n` +
        'Deleting anything is always proposed first. If something is not listed, that part of the app is ' +
        'switched off: say so plainly rather than guessing.'
    );
  } else {
    sections.push('## What you can reach\nNo parts of the app are available to you yet. You can still chat and remember facts.');
  }

  sections.push(
    'When a tool says a change was proposed, tell the person what you proposed in one line and that it ' +
      'is waiting for their OK. Do not repeat the same proposal.'
  );
  sections.push(REMEMBER_INSTRUCTION);
  sections.push(`${KIND_TEXT[input.kind]} ${CHANNEL_TEXT[input.channel]}`);

  if (input.memories.length > 0) {
    sections.push(`## Remembered about this household\n${input.memories.map((m) => `- ${m}`).join('\n')}`);
  }
  if (input.summary?.trim()) {
    sections.push(`## Earlier in this conversation\n${input.summary.trim()}`);
  }

  return sections.join('\n\n');
}

const MARKER_PATTERN = /<remember>([\s\S]*?)<\/remember>/g;

export interface ExtractedMemories {
  /** The reply with every well-formed marker removed and blank lines tidied. */
  cleanedText: string;
  /** Trimmed marker bodies in order; empty ones are dropped. */
  memories: string[];
}

/**
 * Pulls `<remember>…</remember>` markers out of a reply. Works on text, not
 * tool calls, so memory behaves the same on every provider. Unclosed markers
 * are left as they are.
 */
export function extractMemoryMarkers(replyText: string): ExtractedMemories {
  const memories: string[] = [];
  const cleanedText = replyText
    .replace(MARKER_PATTERN, (_match, body: string) => {
      const trimmed = body.trim();
      if (trimmed !== '') memories.push(trimmed);
      return '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { cleanedText, memories };
}
