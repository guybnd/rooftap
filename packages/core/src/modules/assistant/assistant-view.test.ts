import { describe, expect, it } from 'vitest';
import type { AssistantConversation } from './assistant-api';
import { voiceErrorText, voiceLevel, askGreeting, askStarters, assistantModules, popupStatus, conversationTitle, formatCents, formatMicros, groupConversations, looksLikeQuestion, minutesLeft, parseReply, replyPreview } from './assistant-view';

const NOW = new Date('2026-10-21T10:00:00Z');
const conv = (id: string, extra: Partial<AssistantConversation>): AssistantConversation => ({
  id,
  kind: 'chat',
  title: id,
  pinned: false,
  last_active_at: '2026-10-21T09:00:00Z',
  closes_at: null,
  pending: 0,
  ...extra,
});

describe('groupConversations', () => {
  it('splits household, chats (pinned first) and open vs closed quick asks', () => {
    const g = groupConversations(
      [
        conv('h', { kind: 'household' }),
        conv('c1', { last_active_at: '2026-10-21T09:30:00Z' }),
        conv('c2', { pinned: true, last_active_at: '2026-10-20T09:00:00Z' }),
        conv('q-open', { kind: 'quick', closes_at: '2026-10-21T10:20:00Z' }),
        conv('q-closed', { kind: 'quick', closes_at: '2026-10-21T09:40:00Z' }),
      ],
      NOW
    );
    expect(g.household?.id).toBe('h');
    expect(g.chats.map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(g.open.map((c) => c.id)).toEqual(['q-open']);
    expect(g.earlier.map((c) => c.id)).toEqual(['q-closed']);
  });

  it('has no household thread until one is started', () => {
    expect(groupConversations([], NOW).household).toBeNull();
  });
});

describe('labels', () => {
  it('names conversations', () => {
    expect(conversationTitle({ kind: 'household', title: 'x' })).toBe('Household');
    expect(conversationTitle({ kind: 'quick', title: ' ' })).toBe('Quick ask');
    expect(conversationTitle({ kind: 'chat', title: 'Trip' })).toBe('Trip');
  });

  it('counts minutes left on a quick ask only', () => {
    expect(minutesLeft({ kind: 'quick', closes_at: '2026-10-21T10:12:30Z' }, NOW)).toBe(13);
    expect(minutesLeft({ kind: 'quick', closes_at: '2026-10-21T09:00:00Z' }, NOW)).toBe(0);
    expect(minutesLeft({ kind: 'chat', closes_at: null }, NOW)).toBeNull();
  });

  it('formats money', () => {
    expect(formatMicros(0)).toBe('$0.00');
    expect(formatMicros(4_000)).toBe('<$0.01');
    expect(formatMicros(31_000)).toBe('$0.03');
    expect(formatCents(120)).toBe('$1.20');
  });
});

describe('parseReply', () => {
  it('reads paragraphs, lists, bold, italic and links', () => {
    const blocks = parseReply(
      'Here is **this week**:\n\n- Bins on _Tuesday_\n- Pay [power](https://example.com)\n1. First\n\n## Done\nok'
    );
    expect(blocks).toEqual([
      { type: 'paragraph', spans: [{ text: 'Here is ' }, { text: 'this week', bold: true }, { text: ':' }] },
      { type: 'bullet', spans: [{ text: 'Bins on ' }, { text: 'Tuesday', italic: true }] },
      { type: 'bullet', spans: [{ text: 'Pay ' }, { text: 'power', href: 'https://example.com' }] },
      { type: 'number', spans: [{ text: 'First' }], n: 1 },
      { type: 'paragraph', spans: [{ text: 'Done', bold: true }] },
      { type: 'paragraph', spans: [{ text: 'ok' }] },
    ]);
  });

  it('leaves non-http links as text', () => {
    expect(parseReply('[x](javascript:alert(1))')).toEqual([{ type: 'paragraph', spans: [{ text: '[x](javascript:alert(1))' }] }]);
    expect(parseReply('[Open Scout](/shopper/scout/abc-1)')).toEqual([{ type: 'paragraph', spans: [{ text: 'Open Scout', href: '/shopper/scout/abc-1' }] }]);
    expect(parseReply('[x](//evil.example)')).toEqual([{ type: 'paragraph', spans: [{ text: '[x](//evil.example)' }] }]);
  });
});

describe('assistantModules', () => {
  it('lists switched-on modules that have tools, in registry order', () => {
    expect(assistantModules(new Set(['costs', 'household', 'recipes', 'mcp'])).map((m) => m.id)).toEqual(['household', 'recipes', 'costs']);
  });
});

describe('looksLikeQuestion', () => {
  it('reads questions and requests as asks', () => {
    expect(looksLikeQuestion('what can I make with the chicken')).toBe(true);
    expect(looksLikeQuestion('milk?')).toBe(true);
    expect(looksLikeQuestion("What's on this weekend")).toBe(true);
    expect(looksLikeQuestion('plan a dinner for six')).toBe(true);
  });

  it('leaves things to add alone', () => {
    expect(looksLikeQuestion('milk')).toBe(false);
    expect(looksLikeQuestion('call the plumber')).toBe(false);
    expect(looksLikeQuestion('find')).toBe(false);
    expect(looksLikeQuestion('   ')).toBe(false);
  });
});

describe('replyPreview', () => {
  it('flattens the Markdown subset onto one line and trims', () => {
    expect(replyPreview('**Sunday** works.\n\n- Burgers\n- [Buns](https://example.com)')).toBe('Sunday works. Burgers Buns');
    expect(replyPreview('a'.repeat(200), 10)).toBe(`${'a'.repeat(9)}…`);
  });
});

describe('askStarters', () => {
  const day = new Date(2026, 10, 7, 12);
  it('offers one question per enabled module that declares starters, at most four', () => {
    const on = new Set(['household', 'calendar', 'groceries', 'costs', 'recipes', 'bins']);
    const starters = askStarters((id) => on.has(id), 4, day);
    expect(starters).toHaveLength(4);
    expect(new Set(starters.map((s) => s.module)).size).toBe(4);
    for (const s of starters) {
      expect(on.has(s.module)).toBe(true);
      expect(s.text.length).toBeGreaterThan(0);
      expect(s.touches.length).toBeGreaterThan(0);
    }
  });
  it('never offers a module that is off', () => {
    expect(askStarters((id) => id === 'groceries', 4, day).map((s) => s.module)).toEqual(['groceries']);
    expect(askStarters(() => false, 4, day)).toEqual([]);
  });
  it('moves on to other modules the next day', () => {
    const all = () => true;
    const today = askStarters(all, 4, day).map((s) => s.module);
    const tomorrow = askStarters(all, 4, new Date(2026, 10, 8, 12)).map((s) => s.module);
    expect(tomorrow).not.toEqual(today);
  });
  it('skips an ask whose other modules are off, and names them when on', () => {
    for (let d = 0; d < 6; d++) {
      const now = new Date(2026, 10, 7 + d, 12);
      const alone = askStarters((id) => id === 'groceries', 4, now);
      expect(alone.every((s) => s.touches === 'Groceries')).toBe(true);
      const both = askStarters((id) => id === 'groceries' || id === 'recipes', 4, now);
      const tacos = both.find((s) => s.text.includes('tacos'));
      if (tacos) expect(tacos.touches).toBe('Groceries, Recipes');
    }
  });
  it('declares asks in plain copy: no em dashes, no emoji', () => {
    const all = askStarters(() => true, 99, new Date(2026, 10, 7, 12));
    expect(all.length).toBeGreaterThan(8);
    for (const s of all) expect(s.text).not.toMatch(/\u2014|\p{Extended_Pictographic}/u);
  });
  it('stays the same through one day', () => {
    const all = () => true;
    expect(askStarters(all, 4, new Date(2026, 10, 7, 1))).toEqual(askStarters(all, 4, new Date(2026, 10, 7, 23)));
  });
});

describe('popupStatus', () => {
  const now = new Date('2026-11-07T08:00:00Z');
  const base = conv('c', {});
  it('names a new ask, the household thread and a pinned chat', () => {
    expect(popupStatus(null, 'new', now)).toBe('New quick ask');
    expect(popupStatus(null, 'abc', now)).toBeNull();
    expect(popupStatus({ ...base, kind: 'household', closes_at: null }, 'c', now)).toBe('Everyone in the home');
    expect(popupStatus({ ...base, kind: 'chat', closes_at: null }, 'c', now)).toBe('Pinned chat');
  });
  it('counts down an open quick ask and says when it closed', () => {
    expect(popupStatus({ ...base, kind: 'quick', closes_at: '2026-11-07T08:24:00Z' }, 'c', now)).toBe('Takes follow-ups for 24 more min');
    expect(popupStatus({ ...base, kind: 'quick', closes_at: '2026-11-07T07:00:00Z' }, 'c', now)).toBe('Closed after a quiet spell');
  });
});

describe('askGreeting', () => {
  it('greets by the hour with the first name', () => {
    expect(askGreeting('Guy Banda', new Date(2026, 10, 7, 8))).toBe('Morning, Guy.');
    expect(askGreeting('Guy', new Date(2026, 10, 7, 14))).toBe('Afternoon, Guy.');
    expect(askGreeting('Guy', new Date(2026, 10, 7, 21))).toBe('Evening, Guy.');
    expect(askGreeting(null, new Date(2026, 10, 7, 8))).toBe('Good morning.');
  });
});

describe('voice helpers', () => {
  it('stays quiet when the person stopped or said nothing', () => {
    expect(voiceErrorText('aborted')).toBeNull();
    expect(voiceErrorText('no-speech')).toBeNull();
    expect(voiceErrorText('not-allowed')).toMatch(/microphone/);
    expect(voiceErrorText('whatever')).toBe('Could not hear that. Try again.');
  });
  it('maps the input level to 0 to 1', () => {
    expect(voiceLevel(-2)).toBe(0);
    expect(voiceLevel(5)).toBe(0.5);
    expect(voiceLevel(12)).toBe(1);
  });
});
