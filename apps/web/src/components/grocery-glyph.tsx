// Web twin of @homeup/ui's GroceryGlyph (apps/web doesn't consume the RN kit):
// draws a grocery emoji with core's Fluent Emoji Flat SVG so every device
// shows the same art. The markup is generated from a vendored icon set, never
// user input, so inlining it is safe.
import { groceryGlyphSvg } from '@homeup/core';
import { cn } from '@/lib/utils';

export function GroceryGlyph({ emoji, size = 20, className }: { emoji: string; size?: number; className?: string }) {
  const svg = groceryGlyphSvg(emoji);
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center select-none [&>svg]:size-full', className)}
      style={{ width: size, height: size, fontSize: size * 0.85, lineHeight: 1 }}
      {...(svg ? { dangerouslySetInnerHTML: { __html: svg } } : { children: emoji })}
    />
  );
}
