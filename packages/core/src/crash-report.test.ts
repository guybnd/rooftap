import { beforeEach, describe, expect, it } from 'vitest';
import { configureStoreEnvironment, type StoreEnvironment } from './data/store-environment';
import {
  buildCrashReport,
  cleanCrashFrame,
  cleanCrashReport,
  crashIssueBody,
  crashScreen,
  isCrashCountMilestone,
  scrubCrashText,
  type CrashReport,
} from './crash-report';
import { reportCrash, sendKeptCrashes, setCrashReportsEnabled, CRASH_RESEND_MS } from './crash-report-device';

function memoryEnv(): StoreEnvironment {
  const memory = new Map<string, string>();
  return {
    supabase: {} as StoreEnvironment['supabase'],
    getPersistConfig: () => ({}),
    isOnline: () => true,
    isForeground: () => true,
    subscribeReconnect: () => () => {},
    subscribeForeground: () => () => {},
    keyValue: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
      },
    },
    randomUUID: () => 'test-uuid',
  };
}

describe('scrubCrashText', () => {
  it('removes quoted text, emails, links, ids and long numbers', () => {
    const text = scrubCrashText(
      'JSON Parse error: Unexpected "Milk for Dana" from guy@example.com at https://my.server/x?y=1 row 7f9c2b1e-1111-2222-3333-444455556666 total 123456'
    );
    expect(text).not.toMatch(/Milk|Dana|guy@|my\.server|7f9c|123456/);
    expect(text).toContain('<email>');
    expect(text).toContain('<url>');
    expect(text).toContain('<id>');
    expect(text).toContain('<n>');
  });

  it("keeps a quoted property name, which is code and says where it broke", () => {
    expect(scrubCrashText("Cannot read properties of undefined (reading 'toLowerCase')")).toContain("'toLowerCase'");
    expect(scrubCrashText("Cannot read properties of undefined (reading 'Dana')")).toContain('<text>');
  });

  it('drops the rest of an unclosed quote', () => {
    expect(scrubCrashText('Unexpected token in "Pay Dana back')).not.toContain('Dana');
  });

  it('is cut to fit', () => {
    expect(scrubCrashText('x '.repeat(500)).length).toBeLessThanOrEqual(300);
  });
});

describe('cleanCrashFrame', () => {
  it('keeps the function and file, never the host or path', () => {
    expect(cleanCrashFrame('    at suggestReAdd (https://my-home.example.net/_next/static/chunks/app-abc.js:1:2345)')).toBe(
      'suggestReAdd app-abc.js:1:2345'
    );
    expect(cleanCrashFrame('at anonymous (address at /data/user/0/app/files/.expo-internal/abc123:1:3187301)')).toBe(
      'anonymous abc123:1:3187301'
    );
    expect(cleanCrashFrame('render@http://localhost:8081/index.bundle:12:40')).toBe('render index.bundle:12:40');
  });
});

describe('crashScreen', () => {
  it('keeps the route words and hides ids and names', () => {
    expect(crashScreen('/costs/7f9c2b1e-1111-2222-3333-444455556666?tab=1')).toBe('/costs/[id]');
    expect(crashScreen('/recipes/Grandmas%20Pie')).toBe('/recipes/[id]');
    expect(crashScreen('/(tabs)/home')).toBe('/(tabs)/home');
    expect(crashScreen('/')).toBe('/');
    expect(crashScreen(null)).toBeNull();
  });
});

describe('buildCrashReport', () => {
  const error = Object.assign(new TypeError('undefined is not a function'), {
    stack: 'TypeError: undefined is not a function\n    at suggestReAdd (index.android.bundle:1:3187301)\n    at map (native)\n    at Home (index.android.bundle:1:2000)',
  });

  it('builds the fixed fields and nothing else', () => {
    const r = buildCrashReport(error, { platform: 'android', path: '/costs/abc-123', os: 'Android 15', app: '57.6', build: '4f2c1a9' });
    expect(Object.keys(r).sort()).toEqual(['app', 'build', 'frames', 'kind', 'message', 'os', 'platform', 'screen', 'signature']);
    expect(r.kind).toBe('TypeError');
    expect(r.frames[0]).toBe('suggestReAdd index.android.bundle:1:3187301');
    expect(r.screen).toBe('/costs/[id]');
  });

  it('gives the same crash the same signature on another build', () => {
    const other = Object.assign(new TypeError('undefined is not a function'), {
      stack: 'TypeError: undefined is not a function\n    at suggestReAdd (index.android.bundle:1:3190000)',
    });
    const a = buildCrashReport(error, { platform: 'android', app: '57.6' });
    const b = buildCrashReport(other, { platform: 'ios', app: '57.7' });
    expect(a.signature).toBe(b.signature);
    expect(buildCrashReport(new TypeError('x is null'), { platform: 'android' }).signature).not.toBe(a.signature);
  });
});

describe('cleanCrashReport', () => {
  it('scrubs again and recomputes the signature', () => {
    const r = cleanCrashReport({
      kind: 'TypeError',
      message: 'bad "Dana"',
      frames: ['at x (https://host.example/a.js:1:2)', 42],
      screen: '/costs/123',
      platform: 'web',
      os: 'Chrome',
      signature: 'forged',
      email: 'guy@example.com',
    });
    expect(r).not.toBeNull();
    expect(r!.message).not.toContain('Dana');
    expect(r!.frames).toEqual(['x a.js:1:2']);
    expect(r!.screen).toBe('/costs/[id]');
    expect(r!.signature).not.toBe('forged');
    expect(JSON.stringify(r)).not.toContain('guy@');
  });

  it('refuses a report without a platform or message', () => {
    expect(cleanCrashReport({ message: 'x' })).toBeNull();
    expect(cleanCrashReport(null)).toBeNull();
  });
});

describe('crash issue', () => {
  it('names no person and counts repeats', () => {
    const r = buildCrashReport(new Error('boom'), { platform: 'web' });
    const body = crashIssueBody(r, { seen: 3, serverVersion: 'abc1234', selfHosted: true });
    expect(body).toContain('Seen 3 times.');
    expect(body).toContain('self-hosted');
  });

  it('edits the count only at round totals', () => {
    expect([1, 2, 3, 5, 9, 10, 20, 30, 50, 100].filter(isCrashCountMilestone)).toEqual([2, 5, 10, 20, 50, 100]);
  });
});

describe('reportCrash', () => {
  let report: CrashReport;
  beforeEach(() => {
    configureStoreEnvironment(memoryEnv());
    report = buildCrashReport(new Error('boom'), { platform: 'android' });
  });

  it('sends a crash once a week, not on every launch', async () => {
    const sent: string[] = [];
    const send = async (r: CrashReport) => {
      sent.push(r.signature);
      return { result: 'new' as const, to: 'team' as const };
    };
    expect(await reportCrash(report, send, { now: 0 })).toEqual({ result: 'new', to: 'team' });
    expect(await reportCrash(report, send, { now: 1000 })).toBe('known');
    expect(sent).toHaveLength(1);
    expect(await reportCrash(report, send, { now: CRASH_RESEND_MS + 1 })).toEqual({ result: 'new', to: 'team' });
  });

  it('sends nothing when switched off', async () => {
    setCrashReportsEnabled(false);
    expect(await reportCrash(report, async () => ({ result: 'new', to: 'team' }))).toBe('off');
  });

  it('keeps a report from an offline device and sends it later', async () => {
    const offline = async (): Promise<never> => {
      throw new Error('Network request failed');
    };
    expect(await reportCrash(report, offline, { keepOffline: true, now: 0 })).toBe('kept');
    const sent: string[] = [];
    await sendKeptCrashes(async (r) => {
      sent.push(r.signature);
      return { result: 'new', to: 'admin' };
    }, 10);
    expect(sent).toEqual([report.signature]);
  });
});
