// What the person has open when they ask from the pop-up chat, for the
// Assistant's prompt. The app sends only the route, never what is drawn on
// the screen: the model reads the screen's data with its own tools, under
// the same privacy rules as any other lookup.
import { getSectionByPath } from '../../sections';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A route the app may send: an absolute path, no query, of a sane length. Null for anything else. */
export function cleanScreenPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.split(/[?#]/)[0].trim();
  if (!path.startsWith('/') || path.length > 200 || !/^[\w\-/.~]+$/.test(path)) return null;
  return path;
}

/** The prompt section for the screen behind the chat, or null when it adds nothing. */
export function screenPromptText(path: string | null | undefined): string | null {
  const clean = cleanScreenPath(path);
  if (!clean || clean === '/' || clean.startsWith('/assistant')) return null;
  const section = getSectionByPath(clean);
  const id = clean.split('/').find((s) => ID_PATTERN.test(s));
  return (
    `## On their screen\nBehind this chat they have the ${section.label} screen open (${clean}).` +
    (id ? ` It shows one item, id ${id}.` : '') +
    ' When they say "this", "here" or "on screen", they most likely mean it: look it up with your tools instead of asking ' +
    'them to describe it. You know only which screen it is, not what it shows, so never claim to see it.'
  );
}
