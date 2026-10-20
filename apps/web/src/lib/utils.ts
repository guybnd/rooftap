import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Hearth v2's Hero steps (globals.css `.text-hero`, `.text-hero-section`)
// are font sizes, but tailwind-merge reads an unknown `text-<word>` as a
// colour, so `cn("text-hero", "text-foreground")` would drop the size.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["hero", "hero-section"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
