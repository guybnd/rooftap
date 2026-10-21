import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  applyStreamEvent,
  createAssistantStreamReader,
  createSseReader,
  encodeSseEvent,
  visibleDraftText,
  type AssistantStreamEvent,
} from './assistant-stream';
import { AssistantApiError, createAssistantApi, toolStatus, type AssistantStreamCall, type ChatResponse } from './assistant-api';

const response: ChatResponse = {
  conversation: { id: 'c1', kind: 'quick', title: null, pinned: false, last_active_at: '2026-10-21T00:00:00Z', closes_at: null, pending: 0 },
  messages: [],
  budget: 'ok',
};

describe('createSseReader', () => {
  it('reads events split across pieces of any size, skipping comments', () => {
    const seen: string[] = [];
    const reader = createSseReader((d) => seen.push(d));
    const body = `: ping\n\ndata: {"a":1}\n\ndata: {"b":\ndata: 2}\r\n\r\n`;
    for (const ch of body) reader.push(ch);
    reader.end();
    expect(seen).toEqual(['{"a":1}', '{"b":\n2}']);
  });

  it('reads the last event even without its blank line', () => {
    const seen: AssistantStreamEvent[] = [];
    const reader = createAssistantStreamReader((e) => seen.push(e));
    reader.push(encodeSseEvent({ type: 'text', text: 'Hi' }).trimEnd());
    reader.end();
    expect(seen).toEqual([{ type: 'text', text: 'Hi' }]);
  });
});

describe('visibleDraftText', () => {
  it('hides memory markers, finished or still arriving', () => {
    expect(visibleDraftText('Sure. <remember>x</remember> Done')).toBe('Sure.  Done');
    expect(visibleDraftText('Sure. <remember>half')).toBe('Sure. ');
    expect(visibleDraftText('Sure. <rem')).toBe('Sure. ');
    expect(visibleDraftText('a < b')).toBe('a < b');
  });
});

describe('applyStreamEvent', () => {
  it('grows text, shows status until text comes, and clears a step set aside', () => {
    let d = applyStreamEvent(EMPTY_DRAFT, { type: 'text', text: 'Let me look.' });
    d = applyStreamEvent(d, { type: 'status', text: 'Checking Groceries' });
    expect(d).toEqual({ status: 'Checking Groceries', text: 'Let me look.' });
    d = applyStreamEvent(d, { type: 'step' });
    expect(d).toEqual({ status: 'Checking Groceries', text: '' });
    d = applyStreamEvent(d, { type: 'text', text: 'You need milk.' });
    expect(d).toEqual({ status: null, text: 'You need milk.' });
  });
});

describe('toolStatus', () => {
  it('says which places are being checked, or the change being made', () => {
    expect(toolStatus([{ tool: 'get_grocery_items', module: 'groceries', lookup: true, args: {} }])).toBe('Checking Groceries');
    expect(
      toolStatus([
        { tool: 'get_tasks', module: 'household', lookup: true, args: {} },
        { tool: 'get_events', module: 'calendar', lookup: true, args: {} },
        { tool: 'get_budget', module: 'costs', lookup: true, args: {} },
      ])
    ).toBe('Checking Tasks, Calendar and Budget');
    expect(
      toolStatus([
        { tool: 'create_grocery_item', module: 'groceries', args: { name: 'Milk' } },
        { tool: 'create_grocery_item', module: 'groceries', args: { name: 'Eggs' } },
      ])
    ).toBe('Add "Milk" to Groceries and 1 more');
    expect(toolStatus([])).toBeNull();
  });
});

describe('send over a stream', () => {
  const json = async () => {
    throw new Error('not used');
  };

  it('passes progress on and resolves with the done event', async () => {
    const stream: AssistantStreamCall = async (_path, _body, onChunk) => {
      const text = [encodeSseEvent({ type: 'status', text: 'Checking Groceries' }), encodeSseEvent({ type: 'text', text: 'Hi' }), encodeSseEvent({ type: 'done', response })].join('');
      onChunk(text.slice(0, 30));
      onChunk(text.slice(30));
      return { status: 200, contentType: 'text/event-stream; charset=utf-8', text };
    };
    const seen: unknown[] = [];
    const res = await createAssistantApi(json, stream).send({ text: 'hi' }, (e) => seen.push(e));
    expect(res).toEqual(response);
    expect(seen).toEqual([
      { type: 'status', text: 'Checking Groceries' },
      { type: 'text', text: 'Hi' },
    ]);
  });

  it('throws the error event with its code', async () => {
    const stream: AssistantStreamCall = async (_p, _b, onChunk) => {
      const text = encodeSseEvent({ type: 'error', status: 402, error: 'Budget used up', code: 'assistant_budget_reached' });
      onChunk(text);
      return { status: 200, contentType: 'text/event-stream', text };
    };
    await expect(createAssistantApi(json, stream).send({ text: 'hi' }, () => {})).rejects.toMatchObject({ status: 402, code: 'assistant_budget_reached' });
  });

  it('reads an older server that answers with JSON', async () => {
    const ok: AssistantStreamCall = async () => ({ status: 200, contentType: 'application/json', text: JSON.stringify(response) });
    expect(await createAssistantApi(json, ok).send({ text: 'hi' }, () => {})).toEqual(response);
    const refused: AssistantStreamCall = async () => ({ status: 403, contentType: 'application/json', text: JSON.stringify({ error: 'Plus only', code: 'assistant_requires_plus' }) });
    await expect(createAssistantApi(json, refused).send({ text: 'hi' }, () => {})).rejects.toBeInstanceOf(AssistantApiError);
  });

  it('says so when a stream ends without its answer', async () => {
    const cut: AssistantStreamCall = async () => ({ status: 200, contentType: 'text/event-stream', text: encodeSseEvent({ type: 'text', text: 'Hal' }) });
    await expect(createAssistantApi(json, cut).send({ text: 'hi' }, () => {})).rejects.toThrow(/cut off/);
  });
});
