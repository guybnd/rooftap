import { describe, expect, it } from 'vitest';
import {
  appStanding,
  cleanServerUpdate,
  compareVersion,
  serverUpdateNotice,
  shouldAnnounceServerUpdate,
  versionFromTag,
  appStandingLabel,
  appUpdateNotice,
  compareRuntime,
  serverReleaseFromConfig,
  serverVersionLabel,
  shouldAnnounceRelease,
  type ServerRelease,
} from './app-release';

const latest = { version: '1.1.3', runtime: '57.6', url: 'https://github.com/guybnd/rooftap/releases/tag/v1.1.3' };
const server = (over: Partial<ServerRelease> = {}): ServerRelease => ({ version: '1.1.3', minAppRuntime: '57.3', latestApp: latest, ...over });

describe('compareRuntime', () => {
  it('orders runtimes part by part', () => {
    expect(compareRuntime('57.5', '57.10')).toBe(-1);
    expect(compareRuntime('58.0', '57.10')).toBe(1);
    expect(compareRuntime('57.5', '57.5')).toBe(0);
    expect(compareRuntime('nope', '57.5')).toBe(0);
  });
});

describe('appStanding', () => {
  it('says a newer runtime is out', () => {
    expect(appStanding('57.5', server())).toEqual({ kind: 'update', latest });
  });
  it('ignores a newer release on the same runtime: it arrives over the air', () => {
    expect(appStanding('57.6', server()).kind).toBe('current');
  });
  it('says the app is too old for the server', () => {
    expect(appStanding('57.2', server())).toEqual({ kind: 'too-old', latest });
  });
  it('knows nothing without a runtime or a server answer', () => {
    expect(appStanding(null, server()).kind).toBe('unknown');
    expect(appStanding('57.5', undefined).kind).toBe('unknown');
  });
  it('treats an older server with no version fields as current', () => {
    expect(appStanding('57.5', serverReleaseFromConfig({})).kind).toBe('current');
  });
});

describe('announcing', () => {
  it('announces each new release once, and a too-old app every time', () => {
    const update = appStanding('57.5', server());
    expect(shouldAnnounceRelease(update, null)).toBe(true);
    expect(shouldAnnounceRelease(update, '1.1.3')).toBe(false);
    expect(shouldAnnounceRelease(appStanding('57.2', server()), '1.1.3')).toBe(true);
    expect(shouldAnnounceRelease(appStanding('57.6', server()), null)).toBe(false);
  });
  it('writes the notice and status lines', () => {
    expect(appUpdateNotice(appStanding('57.5', server()))?.title).toBe('Rooftap 1.1.3 is out');
    expect(appUpdateNotice(appStanding('57.2', server()))?.title).toBe('Update the app');
    expect(appUpdateNotice({ kind: 'current' })).toBeNull();
    expect(appStandingLabel(appStanding('57.5', server()))).toBe('1.1.3 available');
  });
});

describe('serverReleaseFromConfig', () => {
  it('drops malformed fields', () => {
    expect(serverReleaseFromConfig({ version: 'x', minAppRuntime: 5, latestApp: { version: '1.1.3', runtime: '57.6', url: 'ftp://x' } })).toEqual({
      version: null,
      minAppRuntime: null,
      latestApp: null,
    });
  });
});

describe('serverVersionLabel', () => {
  it('shows the version and the schema date', () => {
    expect(serverVersionLabel(server(), '20261024030000_shopper_source_cache')).toBe('1.1.3 · 2026-10-24');
    expect(serverVersionLabel(serverReleaseFromConfig({}), '20261024030000_x')).toBe('2026-10-24');
    expect(serverVersionLabel(undefined, null)).toBe('Older version');
  });
});

describe('server updates', () => {
  const update = { current: '1.1.3', latest: '1.2.0', url: 'https://github.com/guybnd/rooftap/releases/tag/v1.2.0' };

  it('orders release versions, with a pre-release before its release', () => {
    expect(compareVersion('1.1.3', '1.2.0')).toBe(-1);
    expect(compareVersion('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersion('1.2.0-rc.1', '1.2.0')).toBe(-1);
    expect(compareVersion('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersion('nope', '1.2.0')).toBe(0);
  });

  it('reads a version from a tag', () => {
    expect(versionFromTag('v1.2.0')).toBe('1.2.0');
    expect(versionFromTag('1.2.0')).toBe('1.2.0');
    expect(versionFromTag('android-1.0.0')).toBeNull();
    expect(versionFromTag(undefined)).toBeNull();
  });

  it('keeps only a well-formed, newer release', () => {
    expect(cleanServerUpdate(update)).toEqual(update);
    expect(cleanServerUpdate({ ...update, latest: '1.1.3' })).toBeNull();
    expect(cleanServerUpdate({ ...update, url: 'javascript:alert(1)' })).toBeNull();
    expect(cleanServerUpdate(null)).toBeNull();
  });

  it('announces each release once', () => {
    expect(shouldAnnounceServerUpdate(update, null)).toBe(true);
    expect(shouldAnnounceServerUpdate(update, '1.1.9')).toBe(true);
    expect(shouldAnnounceServerUpdate(update, '1.2.0')).toBe(false);
    expect(shouldAnnounceServerUpdate(null, null)).toBe(false);
  });

  it('names both versions in the notice', () => {
    expect(serverUpdateNotice(update)).toEqual({
      title: 'Server update: Rooftap 1.2.0',
      description: 'Your server runs 1.1.3. Update it to get the new features and fixes.',
    });
  });
});
