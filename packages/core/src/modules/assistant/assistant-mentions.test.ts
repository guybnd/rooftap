import { describe, expect, it } from 'vitest';
import { insertMention, mentionAt, mentionName, mentionOptions, mentionedMembers, suggestMentions } from './assistant-mentions';
import { mentionsRooftap } from './assistant';

const members = [{ user_id: 'me' }, { user_id: 'dana' }, { user_id: 'sam' }, { user_id: 'nameless' }];
const profiles = {
  me: { name: 'Guy Banda', email: 'guy@example.com' },
  dana: { name: 'Dana Levi', email: 'dana@example.com' },
  sam: { name: null, email: 'sam.k@example.com' },
};

describe('household tags', () => {
  it('offers Rooftap first, then the other members by first name', () => {
    expect(mentionOptions(members, profiles, 'me').map((o) => o.name)).toEqual(['Rooftap', 'Dana', 'samk']);
    expect(mentionName({ name: '  Ana-Maria  Lopez' })).toBe('Ana-Maria');
    expect(mentionName(null)).toBeNull();
  });

  it('finds the tag being typed at the caret, not inside an email', () => {
    expect(mentionAt('@')).toEqual({ start: 0, query: '' });
    expect(mentionAt('hey @Ro')).toEqual({ start: 4, query: 'Ro' });
    expect(mentionAt('mail me at guy@exa')).toBeNull();
    expect(mentionAt('hey @Ro there', 7)).toEqual({ start: 4, query: 'Ro' });
    expect(mentionAt('hey @Rooftap ')).toBeNull();
    expect(mentionAt('(@da')).toEqual({ start: 1, query: 'da' });
  });

  it('suggests by prefix, any case, and goes quiet once a tag is complete', () => {
    const options = mentionOptions(members, profiles, 'me');
    expect(suggestMentions(options, '').map((o) => o.name)).toEqual(['Rooftap', 'Dana', 'samk']);
    expect(suggestMentions(options, 'd').map((o) => o.name)).toEqual(['Dana']);
    expect(suggestMentions(options, 'rooftap')).toEqual([]);
    expect(suggestMentions(options, 'zz')).toEqual([]);
  });

  it('puts the picked tag in place with a space after it', () => {
    const rooftap = { name: 'Rooftap', kind: 'rooftap' as const };
    expect(insertMention('hey @ro', { start: 4, query: 'ro' }, 7, rooftap)).toEqual({ text: 'hey @Rooftap ', caret: 13 });
    expect(insertMention('@r what is on', { start: 0, query: 'r' }, 2, rooftap)).toEqual({ text: '@Rooftap what is on', caret: 9 });
    expect(mentionsRooftap(insertMention('@', { start: 0, query: '' }, 1, rooftap).text)).toBe(true);
  });

  it('reads which members a message tags', () => {
    const names = new Map([
      ['dana', 'Dana'],
      ['dan', 'Dan'],
      ['guy', 'Guy'],
    ]);
    expect(mentionedMembers('@dana can you grab milk', names)).toEqual(['dana']);
    expect(mentionedMembers('@Dan and @Guy, dinner?', names)).toEqual(['dan', 'guy']);
    expect(mentionedMembers('email dana@example.com', names)).toEqual([]);
  });
});
