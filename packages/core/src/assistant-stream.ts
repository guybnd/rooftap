// HOUP-509: a chat reply as it happens. /api/assistant/chat answers a request
// that accepts `text/event-stream` with Server-Sent Events: what Rooftap is
// doing while tools run, the answer's text as the model writes it, then the
// same body the JSON answer carries. Older servers ignore the header and
// answer with JSON, so clients must take either.

import type { AssistantErrorCode, ChatResponse } from './assistant-api';

export type AssistantStreamEvent =
  /** A new model call began: text from the step before (it went on to use tools) is set aside. */
  | { type: 'step' }
  /** What Rooftap is doing, e.g. "Checking Groceries". */
  | { type: 'status'; text: string }
  /** More of the answer. */
  | { type: 'text'; text: string }
  /** The turn finished: what the JSON answer would have been. */
  | { type: 'done'; response: ChatResponse }
  | { type: 'error'; status: number; error: string; code?: AssistantErrorCode | null };

/** The reply on screen while it is still being written. */
export interface AssistantDraft {
  status: string | null;
  text: string;
}

export const EMPTY_DRAFT: AssistantDraft = { status: null, text: '' };

export function applyStreamEvent(draft: AssistantDraft, event: AssistantStreamEvent): AssistantDraft {
  if (event.type === 'step') return { status: draft.status, text: '' };
  if (event.type === 'status') return { status: event.text, text: draft.text };
  if (event.type === 'text') return { status: null, text: draft.text + event.text };
  return draft;
}

export function encodeSseEvent(event: AssistantStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** A comment line, which keeps proxies from closing a quiet stream while a tool runs. */
export const SSE_PING = ': ping\n\n';

/**
 * Reads a Server-Sent Events body fed in pieces of any size, calling
 * `onData` with each event's data. Comments and other fields are skipped.
 */
export function createSseReader(onData: (data: string) => void) {
  let buffer = '';
  const flush = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5));
    if (data.length) onData(data.join('\n'));
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      for (const block of blocks) flush(block);
    },
    end() {
      if (buffer.trim()) flush(buffer);
      buffer = '';
    },
  };
}

/** createSseReader for the chat stream's events; anything that isn't one is skipped. */
export function createAssistantStreamReader(onEvent: (event: AssistantStreamEvent) => void) {
  return createSseReader((data) => {
    try {
      const event = JSON.parse(data) as AssistantStreamEvent;
      if (event && typeof event === 'object' && typeof event.type === 'string') onEvent(event);
    } catch {
      // A piece that isn't JSON is not ours.
    }
  });
}

const MARKER_OPEN = '<remember>';

/**
 * The part of a reply still being written that may be shown: memory markers
 * (`<remember>...</remember>`, removed from the stored reply) never appear,
 * including one that has only started arriving.
 */
export function visibleDraftText(raw: string): string {
  let text = raw.replace(/<remember>[\s\S]*?<\/remember>/g, '');
  const open = text.indexOf(MARKER_OPEN);
  if (open >= 0) text = text.slice(0, open);
  for (let k = Math.min(MARKER_OPEN.length - 1, text.length); k > 0; k--) {
    if (MARKER_OPEN.startsWith(text.slice(-k))) return text.slice(0, -k);
  }
  return text;
}
