import { describe, expect, it } from 'vitest';
import {
  makeLinkCode,
  mentionsBot,
  normaliseLinkCode,
  parseProposalCallback,
  parseTelegramCommand,
  proposalCallbackData,
  proposalKeyboard,
  replyToTelegramHtml,
  splitTelegramMessage,
  stripBotMention,
} from './assistant-telegram';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('link codes', () => {
  it('makes six unambiguous characters', () => {
    const code = makeLinkCode(new Uint8Array([0, 1, 2, 30, 31, 255]));
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
  });

  it('normalises typed codes', () => {
    expect(normaliseLinkCode(' ab-c 12d ')).toBe('ABC12D');
  });
});

describe('replyToTelegramHtml', () => {
  it('converts the reply subset and escapes HTML', () => {
    expect(replyToTelegramHtml('Hi **Ana** <3\n\n- Milk & eggs\n- [Bills](https://x.test/a?b=1&c=2)\n\nDone')).toBe(
      'Hi <b>Ana</b> &lt;3\n• Milk &amp; eggs\n• <a href="https://x.test/a?b=1&amp;c=2">Bills</a>\n\nDone'
    );
  });
});

describe('splitTelegramMessage', () => {
  it('keeps short text whole and splits long text at breaks', () => {
    expect(splitTelegramMessage('short', 10)).toEqual(['short']);
    expect(splitTelegramMessage('aaaa bbbb\n\ncccc dddd', 12)).toEqual(['aaaa bbbb', 'cccc dddd']);
  });
});

describe('parseTelegramCommand', () => {
  it('reads commands, with or without the bot name', () => {
    expect(parseTelegramCommand('/start abc-123')).toEqual({ name: 'start', code: 'ABC123' });
    expect(parseTelegramCommand('/start')).toEqual({ name: 'start', code: null });
    expect(parseTelegramCommand('/new what is on today?')).toEqual({ name: 'new', text: 'what is on today?' });
    expect(parseTelegramCommand('/switch@RooftapBot 2', 'rooftapbot')).toEqual({ name: 'switch', index: 2 });
    expect(parseTelegramCommand('/switch x')).toEqual({ name: 'switch', index: null });
    expect(parseTelegramCommand('/household')).toEqual({ name: 'household' });
  });

  it('ignores plain text, unknown commands and other bots', () => {
    expect(parseTelegramCommand('hello')).toBeNull();
    expect(parseTelegramCommand('/weather')).toBeNull();
    expect(parseTelegramCommand('/chats@OtherBot', 'RooftapBot')).toBeNull();
  });
});

describe('mentions', () => {
  it('spots and strips the bot mention', () => {
    expect(mentionsBot('hey @RooftapBot what is for dinner', 'rooftapbot')).toBe(true);
    expect(mentionsBot('hey @RooftapBotX', 'RooftapBot')).toBe(false);
    expect(stripBotMention('@RooftapBot  add milk', 'RooftapBot')).toBe('add milk');
  });
});

describe('proposal buttons', () => {
  it('round-trips callback data under 64 bytes', () => {
    const data = proposalCallbackData(ID, 'confirm');
    expect(data.length).toBeLessThanOrEqual(64);
    expect(parseProposalCallback(data)).toEqual({ decision: 'confirm', messageId: ID });
    expect(parseProposalCallback(proposalCallbackData(ID, 'decline'))?.decision).toBe('decline');
    expect(parseProposalCallback('ok:nope')).toBeNull();
  });

  it('labels the confirm button by count', () => {
    expect(proposalKeyboard(ID, 2).inline_keyboard[0][0].text).toBe('Do all 2');
  });
});
