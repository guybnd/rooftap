import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  LEAD_IN_MIN_MS,
  LEAD_IN_MAX_MS,
  applyStreamEvent,
  createDraftPacer,
  leadInDwellMs,
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
  it('keeps a lead-in on screen until the answer replaces it', () => {
    let d = applyStreamEvent(EMPTY_DRAFT, { type: 'text', text: 'Let me look.' });
    d = applyStreamEvent(d, { type: 'status', text: 'Checking Groceries' });
    expect(d).toEqual({ status: 'Checking Groceries', text: 'Let me look.' });
    d = applyStreamEvent(d, { type: 'step' });
    expect(d).toEqual({ status: 'Checking Groceries', text: 'Let me look.', stale: true });
    d = applyStreamEvent(d, { type: 'text', text: 'You need milk.' });
    expect(d).toEqual({ status: null, text: 'You need milk.' });
    d = applyStreamEvent(d, { type: 'text', text: ' And eggs.' });
    expect(d.text).toBe('You need milk. And eggs.');
  });
});

describe('createDraftPacer', () => {
  function fakeClock() {
    let t = 0;
    const timers: { at: number; fn: () => void }[] = [];
    return {
      now: () => t,
      later: (fn: () => void, ms: number) => void timers.push({ at: t + ms, fn }),
      advance(ms: number) {
        t += ms;
        for (const timer of timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)) {
          timers.splice(timers.indexOf(timer), 1);
          timer.fn();
        }
      },
    };
  }

  it('lets a lead-in be read before the answer replaces it, holding nothing else', () => {
    const clock = fakeClock();
    const shown: string[] = [];
    const pacer = createDraftPacer((d) => shown.push(d.text), clock);
    pacer.push({ type: 'text', text: 'Let me check your list.' });
    pacer.push({ type: 'status', text: 'Checking Groceries' });
    clock.advance(300);
    pacer.push({ type: 'step' });
    pacer.push({ type: 'text', text: 'You need milk.' });
    pacer.push({ type: 'text', text: ' And eggs.' });
    expect(shown.at(-1)).toBe('Let me check your list.');
    clock.advance(LEAD_IN_MIN_MS - 300);
    expect(shown.at(-1)).toBe('You need milk. And eggs.');
  });

  it("doesn't wait when the lead-in has been up long enough already", () => {
    const clock = fakeClock();
    const shown: string[] = [];
    const pacer = createDraftPacer((d) => shown.push(d.text), clock);
    pacer.push({ type: 'text', text: 'Let me check.' });
    clock.advance(5000);
    pacer.push({ type: 'step' });
    pacer.push({ type: 'text', text: 'You need milk.' });
    expect(shown.at(-1)).toBe('You need milk.');
  });

  it('settles once a pending lead-in has had its moment', async () => {
    const clock = fakeClock();
    const pacer = createDraftPacer(() => {}, clock);
    pacer.push({ type: 'text', text: 'Let me check.' });
    pacer.push({ type: 'step' });
    let settled = false;
    void pacer.settled().then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    clock.advance(leadInDwellMs('Let me check.'));
    await Promise.resolve();
    expect(settled).toBe(true);
    expect(leadInDwellMs('word '.repeat(40))).toBe(LEAD_IN_MAX_MS);
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
