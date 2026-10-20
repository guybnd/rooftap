# Rooftap Style Guide

## Design Direction

Dark-first, minimal, functional. The app should feel like a sharp utility — not a marketing page. Think: clean data density, quiet confidence, no visual noise.

## Color System

All colors use OKLCH for perceptual uniformity. The palette is anchored around a deep blue-black base with a teal/mint primary accent.

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `oklch(0.13 0.01 260)` | Page background, deep navy-black |
| `--card` | `oklch(0.17 0.012 260)` | Cards, elevated surfaces |
| `--primary` | `oklch(0.72 0.19 160)` | Teal/mint accent — buttons, active states, links |
| `--muted` | `oklch(0.20 0.012 260)` | Subtle backgrounds, inactive areas |
| `--muted-foreground` | `oklch(0.65 0.02 260)` | Secondary text, icons |
| `--destructive` | `oklch(0.65 0.2 25)` | Errors, dealbreaker flags, delete actions |
| `--border` | `oklch(0.25 0.015 260)` | Card borders, dividers |

Accent colors for data:
- Scores 80%+: `emerald-400`
- Scores 60–79%: `amber-400`
- Scores <60% or dealbreaker: `red-400`

## Typography

- **Font**: Inter (variable weight)
- **Headings**: `font-bold tracking-tight` — tight tracking prevents floaty headers
- **Body**: default weight, `text-sm` for most content
- **Labels**: `text-sm font-medium`
- **Metadata/captions**: `text-xs text-muted-foreground`

## Spacing & Layout

- Page padding: `p-4 sm:p-8`
- Max content width: `max-w-7xl` (dashboard), `max-w-3xl` (forms/settings), `max-w-2xl` (detail)
- Card grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`
- Section gaps: `mb-8` between major sections

## Components

### Cards
- `rounded-xl`, `ring-1 ring-foreground/10`
- Hover: `hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5`
- No heavy shadows at rest — borders define elevation

### Buttons
- Primary: filled `bg-primary text-primary-foreground`, add `shadow-lg shadow-primary/20` for emphasis
- Ghost: used for inline actions (edit, delete)
- Rounded: `rounded-xl` for standalone CTAs, `rounded-lg` for inline

### Badges (ScoreBadge)
- `rounded-lg ring-1` with color-coded bg/text/ring
- Tabular nums for alignment

### Sidebar
- Fixed desktop (w-60), slide-out drawer on mobile
- Logo mark: rounded-lg box with primary bg + letter
- Active state: `bg-sidebar-accent` with full-opacity text
- Inactive: 60% opacity text, hover fills accent

### Empty States
- Centered, with icon in `rounded-2xl bg-primary/10 p-5`
- One headline, one short description, one CTA button

### Searchable Picker (combobox)
- `src/components/ui/searchable-picker.tsx` — the canonical "pick one of many" control. Use it instead of a bare `<select>` whenever the list is searchable, categorised, or long.
- Generic `PickerOption { value, primary, secondary?, group?{key,label,color}, searchText? }`; trigger button → popover with autofocus search, "Recent" pin (`recentCount`), category group headers with a colour dot, keyboard nav, click-outside close, empty state.
- Cost-item adapter lives in `src/lib/cost-items.ts` (`costItemsToOptions`); reuse the pattern for new domains rather than re-implementing filtering.

## Motion

- Transitions: `duration-150` for interactive elements (hovers, active states)
- Sidebar drawer: `duration-200 ease-out`
- No decorative animations — motion should be functional (feedback on interaction)

## Dark Mode

Dark mode is the default and only mode. There is no light mode toggle. All color tokens are designed for dark backgrounds. Do not add `.dark` class overrides — the base `:root` values are already dark.

## Things to Avoid

- Pure white (#fff) text or backgrounds
- Gradient backgrounds or decorative blurs on content
- Rounded-full on rectangular elements (use rounded-xl/2xl)
- Drop shadows without corresponding border definition
- Animations on page load
