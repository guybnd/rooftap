import { describe, expect, it } from 'vitest';
import type { AssistantConversation } from './assistant-api';
import { assistantModules, conversationTitle, formatCents, formatMicros, groupConversations, looksLikeQuestion, minutesLeft, parseReply, replyPreview } from './assistant-view';

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
  it('lists switched-on modules that have tools', () => {
    expect(assistantModules(new Set(['costs', 'household', 'recipes', 'mcp'])).map((m) => m.id)).toEqual(['costs', 'household', 'recipes']);
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
