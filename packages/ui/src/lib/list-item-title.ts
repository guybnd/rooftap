import * as React from 'react';

/**
 * ListItemTitle's children-wrapping rule (HOUP-169 bug fix): a single React
 * element (e.g. a custom `<EditableText>` or a pre-built `<Text>`) renders
 * as-is; a plain string, a number, or a JSX-interpolation array of only
 * primitives like `{emoji} {name}` needs the shared `<Text numberOfLines={1}>`
 * wrapper, or React Native renders loose text nodes it silently drops
 * (the shelf-life screen's 58-blank-row bug). An array containing a React
 * element (e.g. `<Text>` + a trailing `<Pill>`/icon) is a caller-composed
 * layout and must render as-is - wrapping it in `<Text>` would nest a View
 * inside Text and collapse the intended flex-row layout.
 */
export function shouldWrapTitleChildren(children: React.ReactNode): boolean {
  if (Array.isArray(children)) {
    return children.every(
      (c) => c == null || typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean',
    );
  }
  return !React.isValidElement(children);
}
