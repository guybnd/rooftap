// The Settings header's line of people (Hearth §13.12): first names, the
// current person as "you", in plain words.

/** First word of a display name, or the part of an email before the @. */
export function firstName(name: string | null | undefined, email?: string | null): string {
  const n = name?.trim();
  if (n) return n.split(/\s+/)[0];
  const e = email?.split('@')[0]?.trim();
  return e || 'Someone';
}

/**
 * "You", "You and Sam", "You, Sam and Mia", "You, Sam and 3 others".
 * `names` lists the other people in the household; the current person
 * always comes first. Shows at most `max` names before folding the rest.
 */
export function householdPeopleLine(names: string[], max = 3): string {
  const all = ['You', ...names];
  if (all.length === 1) return 'Just you';
  if (all.length <= max) return `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`;
  const shown = all.slice(0, max - 1);
  const rest = all.length - shown.length;
  return `${shown.join(', ')} and ${rest} others`;
}
