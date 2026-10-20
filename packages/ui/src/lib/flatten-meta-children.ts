import * as React from 'react';

/**
 * ListItemMeta's child-flattening rule (HOUP-305 bug fix): `React.Children.
 * toArray` does NOT traverse fragments — a `<>a b c</>` child (e.g.
 * HeroTaskRow's non-done meta branch) counts as ONE child, so all of its
 * fragments landed inside a single `min-w-0 shrink` wrapper View whose
 * default flexDirection is column, stacking them vertically with no `·`
 * separators. Flattening top-level fragments (recursively, since a ternary
 * can nest them) restores one-wrapper-per-fragment and the meta grammar's
 * dot separators.
 */
export function flattenMetaChildren(children: React.ReactNode): ReturnType<typeof React.Children.toArray> {
  return React.Children.toArray(children).flatMap((child) =>
    React.isValidElement<{ children?: React.ReactNode }>(child) && child.type === React.Fragment
      ? flattenMetaChildren(child.props.children)
      : [child],
  );
}
