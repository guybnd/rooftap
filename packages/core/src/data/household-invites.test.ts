import { describe, expect, it } from 'vitest';
import { inviteLinkLifeLabel, inviteTokenFrom, inviteUrl } from './household-invites';
import { authSettingsFrom, deletionPlanLines } from '../auth/account';

const TOKEN = '0123456789abcdef0123456789abcdef';

describe('invite links', () => {
  it('builds the link on the server origin', () => {
    expect(inviteUrl('https://home.example.com/', TOKEN)).toBe(`https://home.example.com/join/${TOKEN}`);
  });

  it('reads the token from a pasted link or a bare token', () => {
    expect(inviteTokenFrom(`https://home.example.com/join/${TOKEN}`)).toBe(TOKEN);
    expect(inviteTokenFrom(`https://home.example.com/join/${TOKEN}?x=1`)).toBe(TOKEN);
    expect(inviteTokenFrom(` ${TOKEN.toUpperCase()} `)).toBe(TOKEN);
    expect(inviteTokenFrom('https://home.example.com/join/short')).toBeNull();
    expect(inviteTokenFrom(`${TOKEN}0`)).toBeNull();
  });

  it('says how long a link has left', () => {
    const now = Date.parse('2026-11-10T00:00:00Z');
    expect(inviteLinkLifeLabel('2026-11-20T00:00:00Z', now)).toBe('Works for 10 more days');
    expect(inviteLinkLifeLabel('2026-11-10T12:00:00Z', now)).toBe('Works until tomorrow');
    expect(inviteLinkLifeLabel('2026-11-09T00:00:00Z', now)).toBe('Ran out');
  });
});

describe('auth settings', () => {
  it('reads sign-up and email from the auth server', () => {
    expect(authSettingsFrom({ disable_signup: false, mailer_autoconfirm: false, external: { email: true } })).toEqual({ signupOpen: true, sendsEmail: true });
    // The stock self-hosted stack: closed, and no mailer.
    expect(authSettingsFrom({ disable_signup: true, mailer_autoconfirm: true, external: { email: true } })).toEqual({ signupOpen: false, sendsEmail: false });
    expect(authSettingsFrom({ disable_signup: false, mailer_autoconfirm: false, external: { email: false } })).toEqual({ signupOpen: false, sendsEmail: false });
    expect(authSettingsFrom(null)).toBeNull();
  });

  it('names what deleting an account does to each home', () => {
    expect(
      deletionPlanLines([
        { household: 'Flat', outcome: 'deleted', heir: null },
        { household: 'Home', outcome: 'handed_over', heir: 'Sam' },
      ]),
    ).toEqual([
      'Flat and everything in it is deleted, because you are its only member.',
      'Home stays. Sam looks after it, and what you added stays with it.',
    ]);
  });
});
