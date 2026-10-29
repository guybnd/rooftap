// Crash reports from the error screen ("This screen didn't load").
//
// When a screen fails, the app sends its own server a short report on its
// own. The server keeps it in the operator's Feedback inbox and, on the
// hosted server, opens one GitHub issue per distinct crash. A self-hosted
// server passes reports on to the Rooftap team only when its operator says
// so (apps/web/src/lib/crash-reports.ts).
//
// A report holds a fixed set of fields and nothing else: the error's kind
// and message, the top stack frames, the screen's route pattern and the app's
// versions. Everything a person typed or a household owns could reach the
// error message, so the text is scrubbed here and again on the server, and
// the route keeps only its fixed words. The signature names the crash across
// versions, so repeats count against one report instead of filing new ones.

export type CrashPlatform = 'android' | 'ios' | 'web';

export interface CrashReport {
  /** The error's class, e.g. "TypeError". */
  kind: string;
  /** The scrubbed message. */
  message: string;
  /** Up to CRASH_MAX_FRAMES frames, "fn file:line:col", no host or path. */
  frames: string[];
  /** The route pattern, e.g. "/costs/[id]"; null when unknown. */
  screen: string | null;
  platform: CrashPlatform;
  /** "Android 15", "Chrome on Windows". */
  os: string | null;
  /** The app's version or native runtime, e.g. "57.6". */
  app: string | null;
  /** The JS build: a commit or OTA update id. */
  build: string | null;
  /** Names the crash across versions (crashSignature). */
  signature: string;
}

/** How the server answered: a new crash, one it already had, or over its limit. */
export type CrashReceipt = { result: 'new' | 'seen' | 'limited'; to: 'team' | 'admin' };

export const CRASH_MAX_FRAMES = 5;
export const CRASH_MESSAGE_MAX = 300;
const FIELD_MAX = 60;

// Property and method names in quotes ("reading 'toLowerCase'") say where a
// crash happened and are code, not someone's data, so they stay. Any other
// quoted text could be a name or an item and goes.
const CODE_WORDS = new Set(['length', 'map', 'filter', 'find', 'then', 'call', 'apply', 'bind', 'name', 'id', 'type', 'value', 'data', 'split', 'trim', 'slice', 'includes', 'replace', 'push', 'get', 'set', 'has', 'default', 'children', 'props', 'state', 'current', 'style', 'key']);

function quoted(inner: string): string {
  const code = /^[a-z_$][\w$]{0,39}$/.test(inner) && (/[a-z][A-Z]|[_$]/.test(inner) || CODE_WORDS.has(inner));
  return code ? `'${inner}'` : '<text>';
}

/**
 * Removes what could be someone's data from error text: quoted text, emails,
 * links, ids and long numbers. What's left is the shape of the error, with
 * <text>, <email>, <url>, <id> and <n> where the rest was.
 */
export function scrubCrashText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(/"([^"]{0,400})"|'([^']{0,400})'|`([^`]{0,400})`|[“‘]([^”’]{0,400})[”’]/g, (_m, a, b, c, d) => quoted(a ?? b ?? c ?? d))
    .replace(/["“][^"”]*$/, '<text>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<id>')
    .replace(/\d{4,}/g, '<n>')
    .trim()
    .slice(0, CRASH_MESSAGE_MAX);
}

/**
 * One stack line, cut to the function name and the file's last part with its
 * line and column. A frame's path can name a self-hosted server's address or
 * the person's device, so neither is kept.
 */
export function cleanCrashFrame(line: string): string | null {
  const text = line.trim().replace(/^at\s+/, '');
  if (!text) return null;
  const loc = /([\w.-]+?):(\d+):(\d+)\)?\s*$/.exec(text);
  const fnMatch = /^([\w$.<>[\]]+)(?=\s*[@(]|\s+\(|\s*$)/.exec(text);
  let fn = fnMatch?.[1] ?? '';
  if (loc && fn === loc[0].replace(/\)$/, '')) fn = '';
  if (/^(address|https?)$/.test(fn)) fn = '';
  fn = fn.slice(0, FIELD_MAX);
  if (!loc) return fn ? fn : null;
  const file = loc[1].replace(/\?.*$/, '').slice(-FIELD_MAX);
  return `${fn ? `${fn} ` : ''}${file}:${loc[2]}:${loc[3]}`;
}

/** The first frames of a stack, cleaned; the message line on top is skipped. */
export function crashFrames(stack: string | undefined | null): string[] {
  if (!stack) return [];
  const lines = stack.split('\n');
  const frames: string[] = [];
  for (const line of lines) {
    // V8 and Hermes put "Kind: message" first; frames are the lines after it.
    if (!/^\s*at\s|@|:\d+:\d+/.test(line)) continue;
    const frame = cleanCrashFrame(line);
    if (frame) frames.push(frame);
    if (frames.length === CRASH_MAX_FRAMES) break;
  }
  return frames;
}

/**
 * A path as its route pattern: every part that isn't a plain lower-case word
 * (an id, a name, a date) becomes "[id]", and the query is dropped.
 */
export function crashScreen(path: string | null | undefined): string | null {
  if (!path) return null;
  const clean = path.split(/[?#]/)[0];
  const parts = clean.split('/').filter(Boolean);
  if (parts.length === 0) return '/';
  return `/${parts
    .slice(0, 6)
    .map((p) => (/^\([a-z-]+\)$|^[a-z][a-z-]{0,30}$/.test(p) ? p : '[id]'))
    .join('/')}`;
}

/** FNV-1a, twice with different seeds: enough to tell crashes apart, and the same on every platform. */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * Names a crash across versions: its kind, its message without numbers, and
 * the function it failed in. Line and column move with every build, so they
 * stay out.
 */
export function crashSignature(r: Pick<CrashReport, 'kind' | 'message' | 'frames' | 'platform'>): string {
  const message = r.message.replace(/<n>|\d+/g, '#');
  const top = (r.frames[0] ?? '').split(' ')[0].replace(/:\d+:\d+$/, '');
  return hash([r.platform === 'web' ? 'web' : 'app', r.kind, message, top].join('|'));
}

function short(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[^\w .()/+-]/g, '').trim().slice(0, FIELD_MAX);
  return text || null;
}

export interface CrashContext {
  platform: CrashPlatform;
  /** The current path; only its pattern is kept. */
  path?: string | null;
  os?: string | null;
  app?: string | null;
  build?: string | null;
}

/** The report for an error, ready to show and send. */
export function buildCrashReport(error: unknown, ctx: CrashContext): CrashReport {
  const err = error instanceof Error ? error : null;
  const kind = short(err?.name) ?? 'Error';
  const message = scrubCrashText(err?.message ?? (typeof error === 'string' ? error : 'No message'));
  const frames = crashFrames(err?.stack);
  const base = { kind, message, frames, platform: ctx.platform };
  return {
    ...base,
    screen: crashScreen(ctx.path),
    os: short(ctx.os),
    app: short(ctx.app),
    build: short(ctx.build),
    signature: crashSignature(base),
  };
}

/**
 * A report from the network, rebuilt field by field and scrubbed again, so an
 * old or altered client can't put more into an issue than this file allows.
 * The signature is computed here, never taken from the sender.
 */
export function cleanCrashReport(raw: unknown): CrashReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const platform: CrashPlatform | null =
    r.platform === 'android' || r.platform === 'ios' || r.platform === 'web' ? r.platform : null;
  if (!platform || typeof r.message !== 'string') return null;
  const frames = Array.isArray(r.frames)
    ? r.frames
        .filter((f): f is string => typeof f === 'string')
        .map((f) => cleanCrashFrame(f.slice(0, 300)))
        .filter((f): f is string => !!f)
        .slice(0, CRASH_MAX_FRAMES)
    : [];
  const base = { kind: short(r.kind) ?? 'Error', message: scrubCrashText(r.message), frames, platform };
  return {
    ...base,
    screen: typeof r.screen === 'string' ? crashScreen(r.screen) : null,
    os: short(r.os),
    app: short(r.app),
    build: short(r.build),
    signature: crashSignature(base),
  };
}

/** The report as the person sees it under "Show details", one field a line. */
export function crashReportLines(r: CrashReport): { label: string; value: string }[] {
  const lines = [{ label: 'error', value: `${r.kind}: ${r.message}` }];
  for (const f of r.frames) lines.push({ label: 'at', value: f });
  if (r.screen) lines.push({ label: 'screen', value: r.screen });
  const app = [r.app && `app ${r.app}`, r.build && `build ${r.build}`, r.os].filter(Boolean).join(' · ');
  if (app) lines.push({ label: 'app', value: app });
  return lines;
}

/** The issue's title. */
export function crashIssueTitle(r: Pick<CrashReport, 'kind' | 'message'>): string {
  const line = `Crash: ${r.kind}: ${r.message}`;
  return line.length > 90 ? `${line.slice(0, 89).trimEnd()}…` : line;
}

/** The issue's body: the report, how often it was seen, and where it came from. Never a name or household. */
export function crashIssueBody(
  r: CrashReport,
  meta: { seen: number; serverVersion: string | null; selfHosted: boolean }
): string {
  const report = crashReportLines(r)
    .map((l) => `${l.label.padEnd(6)} ${l.value}`)
    .join('\n');
  const from = [meta.selfHosted ? 'Sent by a self-hosted server' : 'Sent from the error screen'];
  if (meta.serverVersion) from.push(`server ${meta.serverVersion}`);
  from.push(`signature ${r.signature}`);
  return `\`\`\`\n${report}\n\`\`\`\n\nSeen ${meta.seen} ${meta.seen === 1 ? 'time' : 'times'}.\n\n---\n_${from.join(', ')}._`;
}

/**
 * Repeats edit the issue's count only at these totals, so a common crash
 * doesn't hit GitHub on every report.
 */
export function isCrashCountMilestone(seen: number): boolean {
  if (seen < 2) return false;
  let step = 1;
  while (step * 10 <= seen) step *= 10;
  return seen % step === 0 && [1, 2, 5].includes(seen / step);
}

/** What the error screen says once the report is sent, or null to say nothing. */
export function crashReceiptNote(receipt: CrashReceipt | 'known' | null): string | null {
  if (!receipt) return null;
  if (receipt === 'known' || receipt.result === 'seen') return 'The team already knows about this one.';
  if (receipt.result === 'limited') return null;
  return receipt.to === 'team'
    ? 'We sent the team a report. It has no personal details.'
    : "We sent your server's admin a report. It has no personal details.";
}

/**
 * A prefilled new-issue page on the public repo, for an operator who keeps
 * reports on their server and wants to pass one on by hand.
 */
export function crashUpstreamIssueUrl(message: string, repo = 'guybnd/rooftap'): string {
  const title = message.split('\n')[0].slice(0, 90);
  const body = `${message.trim()}\n\n---\n_Passed on by a self-hosted server's admin._`;
  return `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=crash`;
}

/** The device switch in Settings > About & updates. */
export const CRASH_REPORTS_SETTING = {
  panel: 'Crash reports',
  title: 'Send crash reports',
  description:
    "When a screen doesn't load, this device tells the people who run your server what broke: the error, the app version and the screen. Never your name, household or items.",
} as const;
