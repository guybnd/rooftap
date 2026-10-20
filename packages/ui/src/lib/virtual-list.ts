// HOUP-205: reusable flatten pattern for migrating a grouped ScrollView+ListGroup
// screen to FlashList. `ListGroup` (packages/ui/src/components/list-item.tsx)
// draws its H4 frame (border/radius/shadow) around a whole group of children;
// FlashList needs a flat item array, so `groupFrameClass` reproduces that frame
// per-row instead. Promoted here from apps/mobile/src/lib/virtual-list.tsx in
// HOUP-208 once a second consumer (costs/appointments/checklists/recipes, on
// top of tasks/documents) proved the shape was worth sharing.
import { cn } from './cn';

export type RowPos = 'only' | 'first' | 'middle' | 'last';

export type SectionTone = 'warning' | 'muted' | 'destructive' | 'primary' | 'success';

export type SectionRow<T> =
  | { kind: 'group-header'; id: string; label: string; tone: SectionTone; count?: number }
  | { kind: 'row'; id: string; item: T; pos: RowPos };

export interface FlattenGroupInput<T> {
  /** `key` disambiguates the header's id when two groups could share a `label` (e.g. two members with the same display name); defaults to `label`. */
  header?: { label: string; tone: SectionTone; count?: number; key?: string };
  rows: T[];
}

/** Turns an ordered list of `{ header?, rows[] }` groups into a flat `SectionRow<T>[]`, computing each row's `pos`. */
export function flattenGroups<T>(groups: FlattenGroupInput<T>[], keyOf: (item: T) => string): SectionRow<T>[] {
  const out: SectionRow<T>[] = [];
  for (const group of groups) {
    if (group.rows.length === 0) continue;
    if (group.header) {
      out.push({
        kind: 'group-header',
        id: `group-header:${group.header.key ?? group.header.label}`,
        label: group.header.label,
        tone: group.header.tone,
        count: group.header.count,
      });
    }
    const lastIndex = group.rows.length - 1;
    group.rows.forEach((item, index) => {
      const pos: RowPos = group.rows.length === 1 ? 'only' : index === 0 ? 'first' : index === lastIndex ? 'last' : 'middle';
      out.push({ kind: 'row', id: keyOf(item), item, pos });
    });
  }
  return out;
}

/** Reproduces `ListGroup`'s H4 frame (rounded border, no per-row cards) on a single flattened row. */
export function groupFrameClass(pos: RowPos): string {
  return cn(
    'bg-card border-x border-border',
    (pos === 'first' || pos === 'only') && 'rounded-t-xl border-t',
    (pos === 'last' || pos === 'only') && 'rounded-b-xl border-b',
    (pos === 'middle' || pos === 'last') && 'border-t border-border'
  );
}

/**
 * Reproduces the vertical rhythm the ScrollView's wrapping `View`s used to supply
 * (a gap between groups, and a smaller gap from a group's header to its frame) now
 * that rows are flattened into one list with no wrapper `View`s to carry gap spacing.
 * Defaults match `documents/index.tsx`'s original `gap-4`/`gap-1.5` rhythm; pass
 * `spacing` to reproduce a different screen's original gap values (e.g. tasks' `gap-5`/`gap-2`).
 */
export function rowSpacingClassName<T>(
  prev: SectionRow<T> | undefined,
  current: SectionRow<T>,
  spacing?: { groupGap?: string; headerGap?: string }
): string | undefined {
  if (!prev) return undefined;
  if (current.kind === 'group-header') return spacing?.groupGap ?? 'mt-4';
  if (prev.kind === 'group-header') return spacing?.headerGap ?? 'mt-1.5';
  return undefined;
}
