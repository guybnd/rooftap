// What's new entries (whats-new/README.md): one small markdown file per
// user-facing change, rolled into a generated module in packages/core that
// both apps bundle, so the launch sheet lists what an update brought.
//
//   node scripts/whats-new.mjs            validate, then write the generated module.
//                                         Bad entries are skipped with a warning, so
//                                         an install never fails on one.
//   node scripts/whats-new.mjs check      validate; exit 1 on any problem (npm run check).
//   node scripts/whats-new.mjs pr         CI: fail a PR that changes app code without an
//                                         entry or a "No user change:" line (env BASE_REF,
//                                         PR_BODY, PR_LABELS).
//   node scripts/whats-new.mjs changelog  print CHANGELOG lines for entries newer than
//                                         the last release, for cutting a version.
//
// Plain Node with no dependencies: it runs from postinstall, before anything
// else is built.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_DIR = join(ROOT, 'whats-new');
const OUT_FILE = join(ROOT, 'packages/core/src/whats-new.generated.ts');

export const KINDS = ['feature', 'improvement', 'fix'];
export const PLATFORMS = ['web', 'mobile'];
export const TITLE_MAX = 60;
export const BODY_MAX = 220;
const FILE_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

function read(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

/** Section and module ids, read from core's registries (this script can't import TypeScript). */
function knownModules() {
  const ids = new Set(['app']);
  for (const file of ['packages/core/src/sections.ts', 'packages/core/src/modules.ts']) {
    for (const m of read(file).matchAll(/^\s+id:\s*["']([a-z0-9-]+)["']/gm)) ids.add(m[1]);
  }
  return ids;
}

function knownServerFeatures() {
  const src = read('packages/core/src/server-features.ts');
  return new Set([...src.matchAll(/^\s+'([a-z0-9.-]+)':\s*\{/gm)].map((m) => m[1]));
}

/** Whether an in-app route has a screen on web or mobile (expo-router groups are transparent). */
function routeExists(link) {
  const path = link.split(/[?#]/)[0].replace(/\/$/, '');
  if (existsSync(join(ROOT, 'apps/web/src/app', path, 'page.tsx'))) return true;
  const mobile = join(ROOT, 'apps/mobile/src/app');
  for (const base of [mobile, join(mobile, '(tabs)')]) {
    if (existsSync(join(base, `${path}.tsx`)) || existsSync(join(base, path, 'index.tsx'))) return true;
  }
  return false;
}

/** `key: value` frontmatter between --- fences, then the body. */
export function parseEntryFile(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = /^([a-zA-Z]+):\s*(.*)$/.exec(line);
    if (!kv) return null;
    meta[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { meta, body: m[2].trim().replace(/\s+/g, ' ') };
}

/** Releases from CHANGELOG.md's `## 1.1.0 (2026-10-21)` headings, newest first. */
export function parseReleases(changelog) {
  return [...changelog.matchAll(/^## (\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)/gm)].map((m) => ({
    version: m[1],
    date: m[2],
  }));
}

/** The release an entry shipped in: the oldest one dated on or after it, or null (not released yet). */
export function versionFor(date, releases) {
  let found = null;
  for (const r of releases) if (r.date >= date) found = r.version;
  return found;
}

function copyProblems(label, text) {
  const out = [];
  if (text.includes('—')) out.push(`${label} has an em-dash (Hearth: none in UI copy)`);
  if (EMOJI_RE.test(text)) out.push(`${label} has an emoji (Hearth: none in chrome)`);
  return out;
}

export function loadEntries() {
  const modules = knownModules();
  const serverFeatures = knownServerFeatures();
  const releases = parseReleases(read('CHANGELOG.md'));
  const entries = [];
  const problems = [];
  const files = existsSync(ENTRY_DIR) ? readdirSync(ENTRY_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md') : [];
  for (const file of files.sort()) {
    const fail = (msg) => problems.push(`whats-new/${file}: ${msg}`);
    const name = FILE_RE.exec(file);
    if (!name) {
      fail('name it YYYY-MM-DD-short-slug.md (lower case)');
      continue;
    }
    const parsed = parseEntryFile(readFileSync(join(ENTRY_DIR, file), 'utf8'));
    if (!parsed) {
      fail('needs a --- frontmatter block of `key: value` lines, then the body');
      continue;
    }
    const { meta, body } = parsed;
    const before = problems.length;
    const known = new Set(['title', 'module', 'kind', 'link', 'platforms', 'server', 'spotlight']);
    for (const key of Object.keys(meta)) if (!known.has(key)) fail(`unknown field "${key}"`);
    if (!meta.title) fail('missing title');
    else if (meta.title.length > TITLE_MAX) fail(`title is ${meta.title.length} characters, at most ${TITLE_MAX}`);
    if (!body) fail('missing body (one or two sentences under the frontmatter)');
    else if (body.length > BODY_MAX) fail(`body is ${body.length} characters, at most ${BODY_MAX}`);
    if (!meta.module) fail('missing module');
    else if (!modules.has(meta.module)) fail(`unknown module "${meta.module}" (a section or module id, or "app")`);
    if (!KINDS.includes(meta.kind)) fail(`kind must be one of ${KINDS.join(', ')}`);
    if (meta.link && (!meta.link.startsWith('/') || !routeExists(meta.link))) fail(`link "${meta.link}" is not an app route`);
    const platforms = meta.platforms ? meta.platforms.split(/[\s,]+/).filter(Boolean) : undefined;
    if (platforms?.some((p) => !PLATFORMS.includes(p))) fail(`platforms must be ${PLATFORMS.join(' or ')}`);
    if (meta.server && !serverFeatures.has(meta.server)) fail(`server "${meta.server}" is not in server-features.ts`);
    if (meta.spotlight && meta.spotlight !== 'true' && meta.spotlight !== 'false') fail('spotlight is true or false');
    if (meta.spotlight === 'true' && meta.kind !== 'feature') fail('only a feature can be a spotlight');
    problems.push(...copyProblems(`whats-new/${file}: title`, meta.title ?? ''), ...copyProblems(`whats-new/${file}: body`, body));
    if (problems.length > before) continue;
    entries.push({
      id: file.replace(/\.md$/, ''),
      date: name[1],
      title: meta.title,
      body,
      module: meta.module,
      kind: meta.kind,
      ...(meta.link ? { link: meta.link } : {}),
      ...(platforms ? { platforms } : {}),
      ...(meta.server ? { server: meta.server } : {}),
      ...(meta.spotlight === 'true' ? { spotlight: true } : {}),
      version: versionFor(name[1], releases),
    });
  }
  // Newest first; same-day entries keep a stable order by id.
  entries.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? 1 : -1));
  return { entries, releases, problems };
}

function writeGenerated(entries, releases) {
  const text = [
    '// Generated by scripts/whats-new.mjs from whats-new/*.md. Do not edit: add an',
    '// entry file instead (whats-new/README.md). Regenerated on npm install, before',
    "// core's typecheck and tests, and before the web build.",
    "import type { WhatsNewEntry, WhatsNewRelease } from './whats-new';",
    '',
    `export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = ${JSON.stringify(entries, null, 2)};`,
    '',
    `export const WHATS_NEW_RELEASES: readonly WhatsNewRelease[] = ${JSON.stringify(releases, null, 2)};`,
    '',
  ].join('\n');
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  const old = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8') : null;
  if (old !== text) writeFileSync(OUT_FILE, text);
}

// Code people run: a change here can change what they see. Tests, stories and
// type-only files don't.
const APP_CODE_RE = /^(apps\/(web|mobile)\/src|packages\/(core|ui)\/src)\//;
const NOT_USER_FACING_RE = /(\.test\.[jt]sx?|\.spec\.[jt]sx?|\.d\.ts|\.stories\.[jt]sx?)$|\/__tests__\//;
export const NO_USER_CHANGE_RE = /^\s*No user change:\s*\S/im;
export const NO_USER_CHANGE_LABEL = 'no-user-change';

/** The PR rule, pure for tests: what's wrong, or null. */
export function prVerdict({ changed, body, labels }) {
  const app = changed.filter((f) => APP_CODE_RE.test(f) && !NOT_USER_FACING_RE.test(f));
  if (app.length === 0) return null;
  if (changed.some((f) => /^whats-new\/\d{4}-\d{2}-\d{2}-[^/]+\.md$/.test(f))) return null;
  if (labels.includes(NO_USER_CHANGE_LABEL) || NO_USER_CHANGE_RE.test(body)) return null;
  return [
    `This PR changes app code (${app.slice(0, 3).join(', ')}${app.length > 3 ? ', ...' : ''}) but adds no whats-new entry.`,
    'Add whats-new/YYYY-MM-DD-slug.md for anything people would notice (format: whats-new/README.md),',
    `or put a line "No user change: <why>" in the PR description (or the "${NO_USER_CHANGE_LABEL}" label) for refactors, tests and invisible fixes.`,
  ].join('\n');
}

function changedFiles(base) {
  // Added/modified/renamed files only: deleting an entry doesn't count as one.
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=AMR', `${base}...HEAD`], { cwd: ROOT, encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean);
}

function main() {
  const mode = process.argv[2] ?? 'build';
  if (mode === 'pr') {
    const base = process.env.BASE_REF || 'origin/main';
    const verdict = prVerdict({
      changed: changedFiles(base),
      body: process.env.PR_BODY ?? '',
      labels: (process.env.PR_LABELS ?? '').split(',').map((l) => l.trim()),
    });
    const { problems } = loadEntries();
    for (const p of problems) console.error(p);
    if (verdict) console.error(verdict);
    process.exit(verdict || problems.length ? 1 : 0);
  }
  const { entries, releases, problems } = loadEntries();
  if (mode === 'check') {
    for (const p of problems) console.error(p);
    if (problems.length) process.exit(1);
    writeGenerated(entries, releases);
    console.log(`whats-new: ${entries.length} entries OK`);
    return;
  }
  if (mode === 'changelog') {
    for (const e of entries.filter((x) => x.version === null)) console.log(`- ${e.title}. ${e.body}`);
    return;
  }
  for (const p of problems) console.warn(`warning: ${p} (skipped)`);
  writeGenerated(entries, releases);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
