import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRawText } from './scan.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const configPath = path.join(here, '../../tsconfig.json');
const scan = (name) =>
  scanRawText({ configPath, roots: [path.join(here, 'fixtures')], fileNames: [path.join(here, 'fixtures', name)] });

describe('scanRawText', () => {
  it('reports text that would render outside <Text>', () => {
    const lines = scan('bad.tsx').map((f) => f.line);
    expect(lines.sort((a, b) => a - b)).toEqual([28, 29, 30, 31, 31, 32, 33]);
  }, 60000);

  it('finds no text outside <Text> in the phone app or the shared UI kit', () => {
    const repo = path.join(here, '../../../..');
    const findings = scanRawText({
      configPath,
      roots: [path.join(repo, 'apps/mobile/src'), path.join(repo, 'packages/ui/src')],
    }).map((f) => `${path.relative(repo, f.file)}:${f.line}  ${f.message}`);
    // Wrap the text in <Text>, use `count > 0 &&` for numbers, or put a
    // `raw-text-ok` comment on the line before when the scan is wrong.
    expect(findings).toEqual([]);
  }, 120000);

  it('passes text inside <Text>, guarded numbers and ReactNode pass-through', () => {
    expect(scan('good.tsx')).toEqual([]);
  }, 60000);
});
