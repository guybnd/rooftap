// Guards two bugs where phone code depended on a build-time variable that was
// not there: EXPO_PUBLIC_OFFICIAL_SERVER_URL was never set in CI, so every
// APK said "Official server unavailable" (#454), and EXPO_PUBLIC_GIT_SHA
// stayed empty because Metro's transform cache does not key on env values
// (#660). Both passed CI. An EXPO_PUBLIC_ variable is inlined into the bundle,
// so a missing or stale value ships silently.
//
// A new process.env read in phone code must either be on this list, with a
// code default that works when the variable is missing, or move to
// app.config.ts `extra` (read at runtime from the update manifest, as
// lib/build-info.ts does for the commit).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

/** Variables phone code may read, and why a missing value is safe. */
const ALLOWED: Record<string, string> = {
  EXPO_PUBLIC_PERF_TRACE: 'debug switch, off when missing',
  EXPO_PUBLIC_OFFICIAL_SERVER_URL: 'override only; server-config.ts has the hosted address as its code default',
  NODE_ENV: 'set by the bundler',
  EXPO_OS: 'set by the bundler',
};

function phoneSourceFiles(): string[] {
  const out = execFileSync('git', ['ls-files', 'apps/mobile/src', 'packages/ui/src', 'packages/core/src'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('.web.tsx') && !f.endsWith('.web.ts'));
}

describe('build-time env reads in phone code', () => {
  it('reads only variables with a safe default', () => {
    const unknown: string[] = [];
    for (const file of phoneSourceFiles()) {
      const src = readFileSync(path.join(repoRoot, file), 'utf8');
      for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)|process\.env\[['"]([A-Z0-9_]+)['"]\]/g)) {
        const name = m[1] ?? m[2];
        if (!(name in ALLOWED)) unknown.push(`${file}: ${name}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
