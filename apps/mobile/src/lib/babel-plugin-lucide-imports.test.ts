// Guards babel-plugin-lucide-imports.js (cold start: per-icon lucide imports
// instead of the ~1,640-icon barrel). Runs the plugin through @babel/core on
// samples and on the real source of apps/mobile and packages/ui: any lucide
// import that survives as a barrel import would load every icon again, and
// any icon that misses registration would render black (HOUP-307).
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const babel = require('@babel/core') as {
  transformSync(code: string, options: Record<string, unknown>): { code: string } | null;
};
const plugin = require('../../babel-plugin-lucide-imports.js');

function transform(code: string, filename = '/virtual/file.tsx'): string {
  const result = babel.transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
    plugins: [[plugin, { registry: '/registry.ts' }]],
  });
  return result?.code ?? '';
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

describe('babel-plugin-lucide-imports', () => {
  it('rewrites named icon imports to per-icon modules, resolving aliases, and registers them', () => {
    const out = transform(
      "import { Trash2, AlarmCheck, ChevronDown as Down } from 'lucide-react-native';\nexport const icons = [Trash2, AlarmCheck, Down];",
    );
    expect(out).not.toMatch(/from ["']lucide-react-native["']/);
    expect(out).toContain('import Trash2 from "lucide-react-native/dist/esm/icons/trash-2.js"');
    expect(out).toContain('import AlarmCheck from "lucide-react-native/dist/esm/icons/alarm-clock-check.js"');
    expect(out).toContain('import Down from "lucide-react-native/dist/esm/icons/chevron-down.js"');
    expect(out).toMatch(/_registerLucideIcons\(\[Trash2, AlarmCheck, Down\]\)/);
  });

  it('drops type-only names so nothing pulls the barrel back in', () => {
    const out = transform(
      "import type { LucideIcon as L } from 'lucide-react-native';\nimport { Bell, LucideProps, type LucideIcon } from 'lucide-react-native';\nexport const a: LucideProps | LucideIcon | L | null = null;\nexport const b = Bell;",
    );
    expect(out).not.toMatch(/from ["']lucide-react-native["']/);
    expect(out).toContain('lucide-react-native/dist/esm/icons/bell.js');
  });

  it('leaves no barrel import anywhere in the app or packages/ui source', { timeout: 60_000 }, () => {
    const roots = [resolve(here, '..'), resolve(here, '../../../../packages/ui/src')];
    const offenders = roots
      .flatMap(sourceFiles)
      .filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        if (!source.includes("'lucide-react-native'")) return false;
        return /from ["']lucide-react-native["']/.test(transform(source, file));
      });
    expect(offenders).toEqual([]);
  });
});
