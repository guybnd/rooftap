import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Hearth's type steps (tailwind-preset.js TYPE_STEPS) are font sizes, but
// tailwind-merge only knows Tailwind's own `text-*` sizes and reads any other
// `text-<word>` as a colour. Unregistered, `cn('text-hero', 'text-foreground')`
// would drop the size as a "conflicting colour".
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['hero', 'hero-section', 'display', 'title', 'body', 'caption', 'data-fragment', 'micro-label'] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
