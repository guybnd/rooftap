// HOUP-298: native has no font cascade (unlike web's `font-sans` on the root
// element, apps/web/src/app/layout.tsx) and no other @homeup/ui primitive
// defaults a family, so a bare RN `<Text>` renders the OS default (Roboto),
// not any Hearth face. This wraps RN `Text` and merges in the body face by
// default — callers that set an explicit family class (`font-heading`,
// `font-mono`, or a `text-<step>` size class, which also carries a family
// per the tailwind-preset step->face mapping) still win via `cn`'s
// tailwind-merge. Color is intentionally left alone (inherited/explicit),
// to avoid changing anything beyond the font-family leak this fixes.
import * as React from 'react';
import { Text as RNText, type TextProps } from 'react-native';
import { cn } from '../lib/cn';

function Text({ className, ...props }: TextProps) {
  return <RNText className={cn('font-sans', className)} {...props} />;
}

export { Text };
export type { TextProps };
