---
title: 'Style Guide : Hearth Design Language'
---
# Hearth: the Rooftap Design Language (v2)

> **TL;DR** - One calm briefing instead of nine competing rows, now with a pulse. Hearth is the binding style guide for hierarchy, color, type, touch, motion, and haptics across every Rooftap surface, web and mobile. v2 ("Pulse + Feed", 2026-10-18, PR #329) keeps every v1 rule and adds: a huge Hero number as each surface's lede, a soft section-hued glow behind it, one identity hue per section shown only in leading tiles, a Now card you slide to finish, a day-grouped feed, rare full-screen moments, and the Ember theme pair that follows the device. Any change to `apps/web/src/**`, `apps/mobile/src/**` or `packages/ui/**` that touches rendering must conform to this document.

Built on Bricolage Grotesque (heading face), Geist, Geist Mono and Lucide. Token values live in `apps/web/src/app/globals.css`, which stays the authoritative source for web rendering; `packages/core/src/theme-colors.ts` and `packages/core/src/tokens.ts` (HOUP-67) mirror the same per-theme values for native, with a parity test guarding drift. Section identity hues live in `packages/core/src/section-hues.ts` only; web gets them as CSS from `apps/web/src/lib/section-hue-css.ts` (server-rendered in `layout.tsx`), native reads them directly. This doc defines roles and rules, never duplicate hex/oklch values here.

Rules carry stable ids (`H1`..`H6`, `M1`..`M4`, `T1`..`T4`, `PC`, `E1`..`E4`, `MO`, `HA`). Reference them in tickets and reviews. v2 patterns in §13 are cited by name (Glow, Hero lede, Now card, Feed, Moment, Spaces).

---

## 1. Core rules (H1-H6)

- **H1. One lede per surface.** Every screen and every card leads with exactly one element in display weight. Everything else steps down to body or caption. If two things feel headline-worthy, one of them is wrong. **v2:** a screen's lede is a Hero lede (§13.2): one huge number with what it counts set beside it in words ("3 of 7 left today", "12 to buy", "$2,140 this month"). Home uses the Hero step, section screens the Hero section step. Cards inside the screen still lead with a Display or Title element, never a second Hero.
- **H2. Color has four jobs, never shared.** `--primary` means *interactive*: buttons, active states, links, focus rings, hold fills, the slide-to-finish thumb (coral under Ember, gilt under Axis Mundi). Status hues mean *state* in small doses: a word, a value, a dot, a 3px meter, never a filled block. **Section hues mean *identity*** (§13.0): each section owns one hue, and it appears in exactly two places, the section's leading tile and its glow. A section hue never colors text, buttons, borders, card fills, or meters. Primary is never "healthy". **The one ground exception:** a Moment (§13.5) fills the screen with `--primary`, because it is the product saying "done", and it is dismissed with one tap. **Sanctioned scoped exception (FLUX-1567/1571, amended HOUP-296):** the Axis Mundi theme (`axis-mundi-night`/`axis-mundi-day`) re-splits the accent into three jobs across two hues: `--primary` (gilt) leads *interactive* alone, `--ring` (working blue) takes over *focus and links* alone, and the `--axis` token (gilt, falls back to `--primary` under every other theme) carries *identity* alone (the "yours" avatar ring, the wordmark, the meridian). Interactive is always *filled* gilt; identity is always a gilt *ring/line*. Section tiles keep their hues under Axis; the section glow does not render there (§10.1). **Sanctioned exception (navigation and capture, Guy, Hearth v2 polish):** section hues also carry identity in wayfinding chrome. Every tab glyph (native and phone web) wears its section's glyph hue; the active tab sits on a soft pebble in its tile hue (one shape that glides between tabs, §8 "Tab glide") with its label in its glyph hue, and inactive labels stay muted. The More tab is neutral until the active section lives behind it, then takes that section's hue. The desktop sidebar's section grid follows the same rule. More sheet rows and capture launcher tiles lead with the section's tile; the launcher's on-this-page tile is ringed in its glyph hue; add-as chip glyphs wear their section's glyph hue. The capture '+' stays `--primary` (H5). Nowhere else does a section hue color text, a border or a fill.
- **H3. Meters are local.** A progress bar is scoped to the thing it measures: tile-width in a tile, ~52px inline in a row, always ~3px tall. Edge-to-edge bars are reserved for page-level operations (uploads), never status. **v2:** a Hero lede may carry its own segmented meter under the number (one 3px segment per item, at most 10, finished ones in `--primary`, the rest a faint foreground track, 6px gaps; `meterSegments` in core) whenever there is anything to count. A scaled meter never rounds real progress away: one finish fills at least one segment, and the last fills only when everything is done. The Now card's checklist (§13.3) carries the same segmented meter, in `--success` like every checklist meter.
- **H4. One border level per view.** The outer card owns the chrome (border + shadow). Inside it: inset fills, hairline dividers, spacing. Card-in-card is a smell; if a child needs its own border it wants to be its own sibling. **v2:** the Home lede region has no card at all; it sits on the ground under the glow, and its pulse tiles are translucent cards (`bg-card/70`) so the glow reads through. The glow is ground, not a border level.
- **H5. Controls live with what they control.** A filter sits inside the surface it filters (e.g. the range picker is the list card's header), styled as a recessed track with a raised neutral thumb. Accent fills budget one per layer: the tab bar's capture "+" in chrome, at most one primary action in content. On Home the Now card's slide thumb is that one primary action.
- **H6. Numbers are typographic events.** Tabular figures, value-first, unit in muted small type (`$12,084 of $7,000`). Fragments over sentences ("9 on today", not "9 things on your agenda today"). Lucide over emoji. One middle dot per line, maximum. Relative dates over raw ISO, always ("tomorrow", "3d overdue", never "2026-07-16").

Copy bans (app UI): no em-dash anywhere in UI copy; no emoji in chrome (grocery produce glyphs and recipe method glyphs are content, see tenants); sentence case everywhere; no "smart/seamless" filler.

## 2. Mobile foundations (M1-M4)

- **M1. The thumb owns the bottom.** The tab bar's raised capture "+" anchors the thumb zone (do not add FABs; it already exists in `section-switcher.tsx` / `capture-buttons.tsx`). Screen-level primary actions stay in the bottom half. Rare/risky actions (customize, settings) live top-right, deliberately out of reach.
- **M2. 44px or it isn't a target.** Rows >= 55px, header buttons >= 42px, segments >= 34px inside a >= 44px track, toggles 40x24 with padded hit slop. Visual size can whisper; hit area never does. The slide-to-finish track is 56px tall with a 48px thumb.
- **M3. Gestures first, buttons as proof.** Rows act by swipe (right = complete, left = snooze) and hold (quick edit). The Now card acts by slide (drag the thumb to the end to finish) and pages by a sideways swipe on its top; chevrons beside its page dots are the visible path. Every gesture outcome also exists on a visible path: tap opens the item, the slide thumb is a real button (Enter/Space on web, the "activate" accessibility action on native), and finishing from the Now card shows a toast with Undo. No gesture-only features.
- **M4. Sheets, not modals.** Contextual UI arrives as a bottom sheet: grab handle, `safe-area-inset-bottom` padding, live controls (no Save button when a toggle can just apply). Center dialogs only for destructive confirms. A Moment (§13.5) is the one full-screen surface, and it carries no decisions.

## 3. Color roles

| Role | Token | Allowed uses |
|---|---|---|
| Accent (coral under Ember) | `--primary` | Capture button, active tab/segment text, links, focus rings, hold fills, toggles-on, slide thumb, lede meter segments, the Moment ground |
| Success (green) | `--success` | Completed, under budget, checklist meters, swipe-to-done reveal. Meters + small chips only |
| Warning (amber) | `--warning` | Due soon, unassigned, snooze reveal, approaching a limit, the Now card's "Now" eyebrow. The nudge color |
| Danger (red) | `--destructive` | Overdue, over budget, tab badges, destructive text, the feed's "Earlier" header. A dot, a word, a value, a 3px meter. Never a filled block |
| Section identity | `section-hues.ts` (`--hue-tile`, `--hue-glyph`, `--hue-glow` on web) | The section's leading tile and its glow. Nothing else |

**Section hues (v2).** Home coral, Tasks lilac, Groceries mint, Costs sun, Calendar sky, Recipes peach, Setup rose, Home search teal, Checklists lime, Documents and Profile slate. Each hue has a light and a dark swatch (tile fill, glyph, glow) so it holds on both grounds. Feed rows take the hue of the section that owns the item (`heroItemSectionId`): a cost reminder wears the Costs tile on Home, a viewing wears Home search's.

**Axis Mundi accent split (FLUX-1567/1571, amended HOUP-296, this theme only):** `--primary` (gilt) leads *interactive* (buttons, active tab/segment text, hold fills, toggles-on, the sidebar's active item), `--ring` (working blue) narrows to *focus and links only*, and identity (the "yours" avatar ring, wordmark, section/column capitals, the meridian) stays on the dedicated `--axis` token. Interactive and identity share gilt but stay distinct by **shape**: interactive is always *filled* gilt; identity is always a gilt *ring/line*. Amber stays the only inline "attention" hue on content. `--axis` falls back to `--primary` under every other theme.

Retired patterns: whole-card ownership tints (`cardAccent` in `task-row.tsx`) and colored rails; priority pills using warning/destructive fills; filled resting-state pills ("Needed"); **v2:** per-type tint rings in feed rows (`TYPE_STYLE` / `HERO_TYPE_STYLE`), replaced by the section tile. Identity of *people* lives in the trailing avatar (accent ring = you, or gilt/`--axis` ring under Axis Mundi; dashed amber empty seat = unassigned). Priority is a tinted word in meta, not a pill.

Data/score tints (e.g. apartment scoring) map onto the same roles: >= 80% success, 60-79% warning, < 60% or dealbreaker danger.

## 4. Surface ladder

| Level | Treatment | Use |
|---|---|---|
| Page | `--background` + section glow (Ember) | The canvas. Body texture and the glow live here only |
| Card | `--card` + 1px border + shadow, `rounded-3xl` in v2 | Top-level sections: feed days, Now card, widgets, Spaces tiles, and every `ListGroup` (which defaults to this card on both platforms). The only bordered level |
| Inset | darker fill, no border | Tiles, sheet groups, input wells, segmented tracks, the slide track |
| Raised | lighter fill + hairline + micro shadow | Segmented thumbs, header buttons, hover states |
| Overlay | sheet + dim + grab handle | Bottom sheets, quick-edit menus |
| Moment | `--primary` ground, full screen | §13.5 only |

## 5. Type (T1-T4)

Scale (no in-betweens; `TYPE_SCALE` in `packages/core/src/tokens.ts`):

| Step | Spec | Use |
|---|---|---|
| Hero | 88/800, tracking -0.045em, heading face, tabular | Home's lede number (`.text-hero`, `text-hero`) |
| Hero section | 64/800, tracking -0.04em, heading face, tabular | A section screen's lede number; on Home, a wide lede ("All clear"); a Moment's title (`.text-hero-section`, `text-hero-section`) |
| Display | 24/700, tracking -0.02em, heading face | Card ledes, the Now card's title |
| Title | 16/640, heading face | Row-group titles, sheet titles, a Hero lede's label |
| Body | 14/570 | Row titles, prose |
| Caption | 12/500 muted | Meta lines, a Hero lede's caption |
| Data fragment | 12/570 Geist Mono | Times, countdowns, counts in chips |
| Micro label | 10.5/680 uppercase +0.1em | Sheet group headers, the screen's name above a section lede, feed day headers, "Spaces", the Now card eyebrow |

- **T1. Fonts are the constant, themes are the variable.** No per-section fonts, no per-theme fonts. Sections get identity from their tile, glyph and glow, never from type. **Sanctioned scoped exception (FLUX-1567/1569):** the Axis Mundi theme adds a Trajan-class inscription face (Cinzel) for lapidary capitals ONLY (the wordmark, section-name capitals, column/group headers), never Display/Title/Body prose or data. It is a no-op under every other theme.
- **T2. The heading face is real.** `--font-heading` is bound in `layout.tsx` (Bricolage Grotesque 600-800 via `next/font`, `swap`) and registered in `globals.css`'s `@theme inline` block; native loads the same weights through `expo-font` and the tailwind preset (`BricolageGrotesque_800ExtraBold` for the Hero steps). Scoped to Hero, Display and Title steps only. Axis Mundi's inscription face follows the same pattern as a second, theme-scoped token: `--font-inscription` (Cinzel, weight 600 only, `preload: false`), applied via `.cap-inscription` gated on the Axis Mundi themes.
- **T3. Mono is for fragments, not paragraphs.** Geist Mono takes the data-fragment role: times, countdowns, checklist counts, temperatures, in chips and captions. Money at value size (including a Costs Hero lede) stays in the heading face with tabular figures. Mono never sets a sentence.
- **T4. Readability floors.** Captions >= 11.5px; uppercase micro labels >= 10.5px, always +0.1em; negative tracking only at >= 16px; `tabular-nums` wherever digits columnize (both Hero steps set it); `text-wrap: balance` on headings (already global). **Sanctioned scoped exception (FLUX-1557):** the uppercase-micro-label floor binds the Micro label role only; short tag/status text inside fixed-width chips may drop `uppercase`/tracking instead of widening the pill.

## 6. The line item

The universal row. Base components: `packages/ui`'s `ListItem`/`ListGroup` (native) and `apps/web/src/components/ui/list-item.tsx` (web). Keep the slot API; restyle the dress.

**Anatomy: three slots.** Leading (identity tile or checkbox) / Content (title 14/570 + one meta caption line + optional portal line) / Trailing (max two elements: one value + one identity).

**Leading slot (v2).** Where the leading slot was a type chip (feed rows on Home, Spaces tile headers), it is now the section's **leading tile** (`LeadingTile`, §13.0): 42px in a feed row, 36px in a tile header, 56px reserved for larger headers. A done item swaps the glyph for a check on the same tile. Where the leading slot is interactive (the checkbox on Tasks and Setup rows), it stays a checkbox: a tile is never tappable on its own.

**Container:** one bordered card per *list* (H4) with hairline dividers between rows. Rows are never individually bordered cards.

**States:**
- Yours: accent ring on trailing avatar. No card tint, no rail.
- Unassigned: dashed amber empty avatar slot (tap = assignee picker).
- Overdue: 5px danger dot + relative caption ("3d overdue") in danger text. Title stays neutral.
- Priority: tinted word in meta (High = danger text, Med = warning text, Low = muted). Never a filled pill.
- Done: whole row 55% opacity + thin strikethrough + check in the leading slot. No layout shift.
- Editing (hold): accent fill sweeps from both ends (see Motion).

**Meta grammar:** `status · type · data fragments`, one middle dot between ideas, relative dates, data fragments in mono.

**Tenants matrix:**

| Tenant | Leading | Meta | Trailing | Portals |
|---|---|---|---|---|
| Grocery | item glyph (content exception) | qty · need-by, or have · shelf-life | est price | recipe (accent) |
| Task / reminder (Tasks list) | round checkbox / bell chip | relative due (Today, Tomorrow, a weekday within the week, then a short date; only the due word takes a status hue) · time · checklist meter · priority word | assignee avatar | comments once there are any (checklist opens with the row) |
| Feed row (Home) | section tile (owner's hue) | how overdue, or the time, or nothing when untimed (the day header already says the day) · source | assignee avatar | as its tenant |
| Setup item | square checkbox | store | est price | comments, links; drag handle only in reorder mode |
| Cost item | category chip | provider | amount + cadence word, payer avatar | attachments, comments |
| Document | doc-type chip | type · relative date · expiry (warn < 30d) | uploader avatar | tags (filter in place), reminder |
| Group header | chevron | micro label + count | aggregate value, tabular; colored only when semantic | never |

**Retired from rows everywhere:** inline action icon rows (comment/edit/delete/external/ellipsis: verbs go to tap/hold/swipe); resting-state pills ("Needed" is silence, bought/got = done treatment); in-row add buttons ("+ Link", "+ Reminder", "$ Price" belong to the editor); raw ISO dates.

**The portal contract (PC).** Nouns with a destination (2 attachments, 1 comment, a recipe, a tag, an open reminder) stay in the row as tappable portal chips on the second line, opening their sub-surface as a bottom sheet:
1. Chip shape is the tappable contract; plain meta text is never tappable.
2. A portal tap stops there; it never also opens the row.
3. Chips pad to a 44px hit target at ~24px visual height.
4. Max three portals per row, then a "+N" overflow chip.
5. Accent tint = leaves the section (recipe from groceries); neutral = opens in place (comments, attachments, tags).
6. Horizontal movement wins: starting a swipe cancels any portal tap.
7. A portal with nothing behind it yet (no comments) prints nothing on the row: an empty chip costs every row a line. The way to add the first one lives in the hold menu (a "Comments · Add" row), never as a "0" chip or an in-row verb.

**Search results are real rows.** A capture-search hit renders as its section's own line item (task row, grocery card, cost card, setup card, checklist and recipe rows) with that row's swipe, tick, hold menu and tap, wired to the same writes as its home screen. Only a hit with no row of its own (a viewing, an apartment, a document, a viewing-checklist item) is a plain row: leading tile, title, one meta line, chevron. Results group under one micro label per section, one ListGroup each (H4), capped at three. Inside a sheet, a mostly sideways gesture belongs to the row, and a pull-down dismisses only when every scroller under the finger is at its top.

**Checklist items.** The Completed band lists done items newest checked first, whatever the sort (core `partitionDone`), so the item just ticked sits at its top where an undo reaches for it. In the inline panels (a task row's checklist, the Now card) a tick also shows an "Item checked" toast with Undo; quick ticks coalesce into one pill with a count ("3 items checked"). Unticking shows nothing.

## 7. The pull-up editor (E1-E4)

The shared hold-to-edit menu (`TaskQuickMenuBody` in `task-row.tsx`, shared per FLUX-245) and the item sheets (`ItemFormSheet` in `packages/ui` and `apps/web/src/components/ui/item-form-sheet.tsx`).

- **E1. The header states the item.** Title (Title step) + one caption of facts: type, progress, relative due. Never raw ISO (`dueMeta()` already computes relative labels; use it). **v2:** an item sheet's header leads with the section's leading tile (`section` prop), the same tile the item wears in its row and in the feed, so opening an item feels like zooming into it. Task, cost, setup, event, viewing and document sheets pass it on both platforms; grocery and recipe sheets keep their per-item glyph (content), and take no tile.
- **E2. Property rows show their value.** Due, Repeat, Assignee, Priority each render current state right-aligned with a chevron. The whole item is readable with zero taps.
- **E3. Every property is a sub-panel.** Repeat joins date/snooze/assignee as a sub-panel instead of dumping five options inline. Sub-panels get a back row. Selection = accent text + check; commits fire `tick()`.
- **E4. Destructive sits alone.** Delete: last, its own inset group, danger text, no fill, `warn()` when the confirm appears. Groups are inset panels with micro labels, identical to the customize sheet.

## 8. Motion (MO)

Tokens (CSS variables on web, `MOTION_DURATIONS_MS`/`MOTION_EASE` in `packages/core/src/tokens.ts` on native; `transform`/`opacity` only; nothing loops except skeletons; `prefers-reduced-motion` collapses to instant):

| Token | Value | Use |
|---|---|---|
| fast | 150ms swift-out | backdrop fades, fill retreats, hover |
| base | 200ms swift-out | swipe snap-back, segmented thumbs, toggles, menu pop, slide thumb return |
| slow | 300ms swift-out in / 250ms ease-in out | sheets, page draw-back, a Moment arriving |
| settle | 240ms swift-out, after a ~1.2s beat | list reflow: done row collapsing, siblings breathing up |
| gesture | none | 1:1 finger follow; release animates the remainder at base |

`swift-out = cubic-bezier(0.16, 1, 0.3, 1)`. Exits use plain ease-in (things leave quicker than they arrive). Existing `stagger-in` page load keeps its 400ms cap.

**Choreography:**
- **Complete (swipe right):** follow 1:1; at the 72px trigger the check pops + `tick()`; release snaps back at base; row settles to done state (55% + strikethrough) + `success()`; after the beat the row slot collapses at settle and the list breathes up.
- **Snooze (swipe left):** amber reveal; after duration pick the row slides out left and fades at 240ms ease-in; siblings close the gap. `tick()` at threshold only (postponement is not a celebration).
- **Slide to finish (v2, Now card):** the thumb follows the finger 1:1 and the track fills behind it; the label fades as the thumb travels. Crossing 82% of the travel arms it with `tick()`. Releasing armed finishes: the thumb lands at the end, shows a check, `success()`. Releasing short returns the thumb at base. As it lands the check pops (to ~1.16 and back, fast then base) and a small coral burst leaves the thumb (a thin ring that swells and fades, eight sparks that travel ~26px out and fade, over slow). After ~600ms the card leaves (exit, ease-in, fade and 16px drift left), the item is marked done, and the next queue item arrives in its place (slow, swift-out, fade up from a 16px drift). Reduced motion: no pop, burst, leave or arrive; the check shows for the same beat and the next card swaps in.
- **Page turn (Now card):** the drag follows 1:1 with resistance past the ends; a release past ~22% or a flick turns it, the rest animates at base; chevrons glide at base; no haptic (paging is travel).
- **Lede meter fill:** a newly filled segment sweeps in from its left edge at slow (scaleX, swift-out); an emptied one retreats at fast; mounting never animates.
- **Moment (v2):** the coral ground fades in at slow and the check scales in from 50% at slow; reduced motion shows it instantly with no scale. It never auto-dismisses and never loops.
- **Pull tab (bottom sheet):** open: sheet slides up at slow, backdrop fades at fast, the page behind draws back to ~96% scale and dims. Close: sheet leaves at 250ms ease-in, page draws back in at slow. Drag follows 1:1; flick past 30% dismisses; `tick()` crossing the dismiss line.
- **Tab glide (Guy, tab bar polish):** the tab bar's active highlight is one pebble behind the tabs, a gently lopsided rounded shape around the active tab's glyph and label (core `tab-glide.ts`: `TAB_GLIDE_SIZE`; web draws the outline with `tabBlobPath`, native draws a rounded view with uneven corners that `tabPebbleMetrics` stretches and leans with transforms only, since animated SVG broke on Android). On a tab change it rides the page shift's own timing (§8.1 Shift: `slow`, swift-out), never a separate spring: its centre is always exactly as far along the hop as the page has slid, and on that same progress it stretches into a droplet that thins as it goes, its crest leaning forward and its back drawn to a tail, widest early in the trip and back to rest as the page lands (`tabGlideEdges`, `TAB_GLIDE_STRETCH`). Web reads the glide straight off the page's Shift animation clock (`navShiftElapsedMs`); native starts it in the same JS turn the tab navigator starts the page, on the navigator's own transition spec. Its fill crossfades from the old section's tile hue to the new one on the same timing. Nothing may re-render the native tab navigator while it slides (it restarts the slide), so the (tabs) layout keeps the navigator memoized away from path and data changes. The glyph of the tab just arrived at pops once (to ~1.14 at fast, back at base); a tab that is active on first paint doesn't. Tabs squish to 0.94 while pressed. Reduced motion: the pebble jumps, no stretch, no pop. No haptic (switching tabs is travel).
- **Tab slot pick (Guy, tab bar):** holding a tab for 450ms opens a sheet listing every section the household has on (bar ones marked In bar, hidden ones Hidden, the held one checked); picking one swaps the two in the saved section order (core `assignTabSlot`), so Settings > Navigation shows the same order. `commit()` when the hold fires, `select()` on a pick. The More sheet lists every visible section too, with the bar's own marked In bar. Web times the pointer itself (iOS Safari has no long-press event) and also opens it on contextmenu.
- **Hold to edit:** 100ms grace (`fillDelayMs`), fill sweeps from both ends over ~400ms charging as it goes (§9 Charge), `commit()` when it fires, menu pops at base (scale 0.97 to 1). Early lift retreats the fill at fast with no haptic (nothing changed).

The section glow is ground, not page (Guy, tab bar polish): it never shifts or fades with a page. On a section change it stays put and blends from the old section's glow hue to the new one on the page shift's timing (`slow`, swift-out), in step with the tab glide. Web paints it once behind the routed region, outside the `route-content` group, and transitions a registered `--glow-hue`; native paints it once behind every section root (`TabGround` in the (tabs) layout, whose roots' `ScreenBackground` stay clear) and crossfades two static glows. A root's borrowed glow (Home's open lens) blends the same way. Reduced motion: it swaps.

### 8.1 Navigation choreography

Route changes use the browser View Transitions API (`document.startViewTransition()`, wrapped by `src/lib/view-transitions.ts`), not React's `<ViewTransition>` component, which needs a `react@canary` build this repo doesn't carry. Unsupported browsers, and `prefers-reduced-motion`, both fall back to a plain instant navigation.

The routed content wrapper (`app-sidebar.tsx`'s `.route-transition-region`) carries the route's named transition group (`route-content`); the sidebar, top bar, tab bar and the section glow behind the region stay in the unnamed root group with `animation: none`. Chrome never animates, on every navigation type, with two exceptions, both in step with the page: the tab bar's pebble glides to the new tab (§8 "Tab glide"), and the section glow blends into the new section's hue (§8, §13.1). The phone tab bar's raised "+" has its own still group (`capture-fab`) so the shifting page never paints over it.

| Behavior | Trigger | Motion |
|---|---|---|
| **Shift** | Lateral tab switch (section change) between two sections in the bar | The page moves the way the tab bar's pebble travels. Toward the end of the bar (`shift-forward`): the old page drifts left and fades while the new one comes in from the right; back toward the start (`shift-back`) mirrors it. Distance `--nav-shift`, 28% of the width (core `TAB_SHIFT_FRACTION`) capped at 140px, clipped to the content region; `--motion-slow`, swift-out. Direction comes from the bar's order (`tabTravelDirection`). Native does the same through the tab navigator, whose screens are ranked in the bar's order. |
| **Crossfade** | Lateral switch to or from a section that isn't in the bar | `route-content` crossfades old/new at `--motion-fast`. |
| **Descend** | List -> detail (e.g. recipes list -> recipe detail, checklists list -> checklist detail) | Destination slides in from the right at `--motion-slow`; origin draws back ~30% (`translateX(-30%)`) + dims (`brightness(0.85)`). |
| **Back** | Detail -> list, reversing a descend | Origin exits right at `--motion-exit`; destination un-draws-back and un-dims at `--motion-slow`. Never wired to the system edge-swipe-back gesture. |
| **Portal jump** | A PC5 accent chip that leaves the section (e.g. a grocery row's recipe chip -> recipe detail) | The tapped chip and the destination's lede share one `view-transition-name` (`portal-<entity>-<id>`), set at tap time via `tagPortalMorph()` and claimed on the destination only when it was reached via a portal tap (`data-nav-transition="portal"` on `<html>`). Unsupported browsers get an instant swap. |

Zero haptics fire on any pure navigation; haptics mark state changes, not travel.

Scroll restoration on Back is the App Router's own default behavior. Currently wired: section tab switches (`app-sidebar.tsx`), the recipes list <-> recipe detail pair, the checklists list <-> checklist detail pair, and the groceries -> recipe portal jump.

## 9. Haptics (HA)

One principle: **haptics mark state changes, never touches.** One shared module per platform (`apps/web/src/lib/haptics.ts`, `packages/ui/src/lib/haptics.ts` with its `.native.ts` twin); the vocabulary (names, web patterns, effect steps) lives in core `tokens.ts`. Never call `expo-haptics` or `navigator.vibrate` directly.

| Pulse | Native feel | Web pattern (ms) | Fires on |
|---|---|---|---|
| `select()` | selection click | 6 | a choice changed: Switch flips, SegmentedControl picks, chips, filters, pick-one rows, sort modes, unchecking. Built into `Switch` and `SegmentedControl`, so callers never add their own |
| `tick()` | light impact | 10 | detents and small arrivals: scroll-field steps, swipe crossing 72px, sheet crossing dismiss line, slide-to-finish crossing its threshold, checking one item off a list |
| `commit()` | medium impact | 15 | hold-to-edit firing, drag-drop landing, quick-add submit |
| `success()` | success notification | 12, 60, 12 | task completed (swipe or slide), a grocery marked got, save landing |
| `warn()` | warning notification | 10, 50, 10 | destructive confirm appearing, budget crossing its limit while editing |
| `error()` | error notification | 16, 40, 16, 40, 16 | a save or action that failed (error toasts fire it) |
| `remove()` | rigid impact | 22 | the delete itself, after any confirm |
| `celebrate()` | light, medium, heavy roll into success | 8, 60, 10, 60, 14, 90, 12, 60, 12 | big finishes: a checklist reaching 100%, the grocery list cleared, the All clear Moment |

**Effects** ride a gesture instead of answering one event (Guy, 2026-10-19, haptics pass):
- **Charge (hold to edit):** `useHoldFill` buzzes `charge()` as the fill passes `HOLD_CHARGE_STEPS` (soft, then light), so the caller's `commit()` lands as the third and firmest beat. A lift before a step is silent; a retreating fill never buzzes.
- **Zipper (slide to finish):** the thumb clicks `zipper()` at each `SLIDE_ZIPPER_STEPS` quarter, each firmer, then `tick()` at the threshold and `success()` on the finish. Dragging back over a step doesn't repeat it.
- **Disarm (swipe rows):** pulling a swipe back under its trigger line clicks `select()`, softer than the `tick()` that armed it.

A Moment lands with `celebrate()` as it appears, after the `success()` the finishing gesture already fired. Every pulse obeys the device-local **Haptics** switch (Settings > Appearance; `setHapticsEnabled`). `navigator.vibrate` is Android-only (iOS Safari no-ops): a haptic is always a bonus layered on visible feedback, never the only signal. Reduced motion does NOT disable haptics. Tab switches, page turns and other pure navigation stay silent.

## 10. Themes

Hearth is composition; it must survive every theme untouched. Themes own hue, radius, texture, shadow. Hearth owns hierarchy, meter scale, spacing rhythm, accent discipline.

**v2 roster: four themes in two pairs.**

| Pair | Ids | Character |
|---|---|---|
| **Ember** (default) | `ember-day`, `ember-night` | Coral `--primary`, warm paper (day) and warm ink (night) grounds, a rounder radius (1.125rem), the section glow on. |
| **Axis Mundi** | `axis-mundi-day`, `axis-mundi-night` | Gilt accent split, masonry surfaces, Cinzel capitals, the meridian (§10.1). No section glow. |

**The setting is a preference, not a theme** (`packages/core/src/theme-preference.ts`). The default preference `system` ("Match device") follows the phone or browser's light/dark setting and resolves to Ember Day or Ember Night; picking any of the four themes pins it. Both platforms resolve through `resolveThemePreference`, so web and native never disagree. The preference is stored under `homeup-theme-pref`, a new key, so everyone starts on Match device and Axis stays one tap away in Appearance settings.

### 10.1 Axis Mundi (FLUX-1567 epic)

The theme pair layering a small, scoped design-language addition on top of Hearth: cut-stone ("masonry") surfaces, lapidary capitals (T1's Cinzel exception, see §5), and **the meridian**: exactly one vertical gilt axis per surface, gated entirely to these two themes and a no-op everywhere else.

- **One meridian per surface.** Web: `src/components/ui/meridian-axis.tsx` renders `<MeridianAxis variant="hero" | "dock">`; CSS lives in `globals.css` under `.meridian-axis` (`display:none` by default, revealed only under the Axis Mundi themes). Two mount points only: the home lede (`summary-hero.tsx`) and the mobile web dock (`section-switcher.tsx`). Native (HOUP-171): `packages/ui/src/components/meridian-axis.tsx`, gated via `useThemeMaterial().axisColor`; mounted in the Home hero region (`hero`) and the tab bar's capture column (`dock`). It never runs through dense list rows.
- **Gilt is Axis's only glow.** Under Axis Mundi the hero node's static glow is the sole decorative glow, so the section glow is switched off there (`useThemeMaterial().sectionGlow` on native, `[data-theme^="axis-mundi"] .section-glow { display: none }` on web). Under Ember the section glow is the only decorative glow and there is no meridian.
- Before adding a third meridian mount point, re-read this rule: the motif is deliberately singular per view, not a general-purpose divider.
- **The accent split (FLUX-1571, amended HOUP-296): see H2 and §3.**

## 11. Layout and component conventions

- **Page padding:** `p-4 sm:p-8`. **Content widths:** `max-w-7xl` dashboard, `max-w-3xl` forms/settings, `max-w-2xl` detail views.
- **Card grids:** `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`; section gaps `mb-8`.
- **Cards at rest:** border defines elevation (H4), soft resting shadow only (`--card-shadow`). v2 cards are `rounded-3xl`. Hover may add `border-primary/30`.
- **Buttons:** primary = filled accent (respect the H5 accent budget); ghost for inline verbs; `rounded-xl` standalone, `rounded-lg` inline.
- **Empty states:** centered; icon in `rounded-2xl bg-primary/10 p-5`; one headline, one short description, one CTA. Native/universal screens use the shared `packages/ui/src/components/empty-state.tsx` (`EmptyState`) instead of a hand-rolled dashed box (HOUP-169).
- **Searchable picker:** `src/components/ui/searchable-picker.tsx` is the canonical "pick one of many" control. Use it over a bare `<select>` for long/categorised lists.
- **Pulse tile:** `src/components/ui/pulse-tile.tsx` is the canonical inset "stat" tile for a lede's pulse strip (`label` micro-caption + `value` tabular figure + optional `meter` + `tone`). Omit `meter` for a delta/bare-count tile (H3).
- **Section screen shell:** `packages/ui/src/components/section-screen.tsx` (`SectionScreen`) owns the native section screen scaffold: `ScreenBackground` (texture + glow) + `ScrollView` + safe-area math + padding/gap + the H1 lede slot (HOUP-169).
- **Section screen head (v2):** a micro label naming the screen on the left with the screen's actions on the right, then the Hero lede on the ground, then the screen's cards. The screen's name is never also a Display title.
- **Folders and files:** folders lead as a grid of neutral tiles (2 columns on phone, 3 on wide screens) under a "Folders n" micro label; documents follow as line items in one card per section ("Expiring soon n", then "Files n"). A folder never shares a card with documents. Inside a folder the path heads the screen as micro labels and the Hero lede counts that folder's subtree ("3 in Home").
- **Bottom clearance:** a list above the in-flow tab bar clears only the capture button's raised lip (about 32px). The tab bar pads the safe area itself, so adding `insets.bottom` or a floating-bar allowance again leaves an empty band under the last card.

## 12. Rollout map

Epic: **FLUX-268** (v1).

1. **FLUX-269** - Home summary hero recomposition (lede, people line, 2x2 pulse grid, tip line).
2. **FLUX-270** - The list card: range picker + quick-add into the list header, type filter beside the count.
3. **FLUX-271** - Unified line item + portal contract across all sections.
4. **FLUX-272** - Pull-up editor property rows + inset groups on customize/settings sheets.
5. **FLUX-273** - Section pages: ledes + pulse strips for Costs, Groceries, Setup, Appointments.
6. **FLUX-274** - Motion and haptics pass (tokens, haptics.ts, sheet slide + draw-back, choreography).
7. **FLUX-275** - Type pass (bind `--font-heading`, load Geist Mono, readability floors).

**v2 (Pulse + Feed), PR #329:** Ember pair + Match device; section hues, tiles and glow; Hero ledes on Home, Tasks, Groceries, Costs and Calendar; the Now card with slide to finish; the day-grouped feed; the All clear Moment; Spaces; item sheet tiles; then Hero ledes on Recipes, Setup, Documents, Checklists, Home search and Appointments. Both platforms. Not yet done: the weekly recap Moment (deferred).

## 13. v2 patterns (Pulse + Feed)

Each pattern has one component per platform; screens never hand-roll them.

| Pattern | Native (`packages/ui`) | Web (`apps/web/src/components/ui`) |
|---|---|---|
| Leading tile | `leading-tile.tsx` | `leading-tile.tsx` |
| Section glow | `section-glow.tsx` (`TabGround` under the tabs; `ScreenBackground sectionId`, `SectionProvider`) | `section-glow.tsx` (mounted once in `app-sidebar.tsx`, behind the routed region) |
| Hero lede | `hero-lede.tsx` | `hero-lede.tsx` |
| Slide to finish | `slide-to-complete.tsx` | `slide-to-complete.tsx` |
| Now card | `now-card.tsx` | `now-card.tsx` |
| Moment | `moment.tsx` | `moment.tsx` |

Data rules live in core so both apps agree: `section-hues.ts` (hues), `feed.ts` (`groupFeedItems`, `feedDayLabel`, `heroItemSectionId`, `todayProgress`, `pickNowItem`, `meterSegments`, `earnedAllClear`).

### 13.0 Section hues and the leading tile

A rounded square in the section's tile hue holding the section's own Lucide glyph (its `sections.ts` icon) in the glyph hue, stroke 2.1. It is identity, not a control: it never takes a tap of its own and never carries a badge. Unknown sections fall back to slate. The tile also leads each More sheet row and capture launcher tile; a count that belongs to the section (overdue tasks) trails the row, never sits on the tile.

### 13.1 Glow

A soft radial wash of the current section's glow hue from the top-right of the screen, behind content, about 420px tall, fading to nothing. Strength is per scheme (stronger on dark ground). One glow per screen, always the current section's (or the one its root borrows); it holds still while content scrolls and pages shift over it, and its only motion is blending into the next hue on a section change (§8). Ember only (§10.1). Never put a second glow inside a card.

### 13.2 Hero lede

The screen's H1. One number in a Hero step, its label in words beside it (Title step, muted), at most one caption line of fragments under it, and the H3 lede meter whenever there is anything today. It sits on the ground, not in a card. Rules:
- Count what the person can act on now ("left today", "open", "to buy", "on today"), not totals of history.
- A non-numeric or wide value ("All clear", a money amount) uses the Hero section step, also on Home.
- Status in the caption is a tinted fragment ("2 overdue" in danger text), never a tinted Hero number, except a lede that *is* a status (over budget) may take `tone`.

### 13.3 Now card

On Home, under the lede: the next few things to do, one card at a time (`pickNowQueue`: timed open items soonest first, then overdue to-dos, then open to-dos due today; never an undated or done item; at most `NOW_QUEUE_MAX` = 8; the first is `pickNowItem`). A bordered `rounded-3xl` card: leading tile, an eyebrow micro label ("Overdue" in danger, "Now" in warning when due within the hour, otherwise "Next up" or "Today" muted), the title at Display, one meta line (time · countdown in mono, source), and slide to finish when the item is a task or reminder.

The card is a pager: swipe sideways on its top (tile, title, meta) to look ahead or back; the slide track keeps its own drag and never turns the page, and a vertical drag stays the screen's scroll. Page dots sit under the card with a chevron either side (the visible path, M3). The pager follows the head until the person pages, then holds their item; when it leaves, the next one takes its place (`nowQueueIndex`). Cards in the pager share the tallest card's height, slide track at the bottom.

Tapping the card opens the item (`heroItemOpenTarget`): a reminder shown while Tasks is off its owner screen, any other task its editor, a viewing its listing, a pulled event Google Calendar. A dated checklist's to-do opens in place instead: its card carries the list's own segmented meter under the meta line ("3 of 8", H3), a chevron on the top marks it, and tapping the top shows the list inside the card (the same inline panel a task row opens, with "Open full checklist" for the detail screen) and folds it again. Turning the page folds it; an open card grows alone while its neighbours keep their own height. Finishing celebrates on the card (§8), then the next item takes its place, with a "Done" toast and Undo. The finish burst is not a Moment: one shot, tied to the thumb, never a ground. At most one Now card per screen, and only on Home.

On Home a done feed row undoes only on purpose: swipe right, the hold menu's "Mark not done", or the Done toast; a tap never un-ticks (meta: "Done · swipe to undo").

### 13.4 Feed

Home's agenda list. Items group under micro-label day headers (`feedDayLabel`): Earlier (danger text, for overdue), Today, Tomorrow, weekday names within a week, then short dates, then "No date". Each row is a line item with the owner section's tile (§6) and a single trailing fact: how overdue it is, its time, or nothing for an untimed item (`feedRowWhen`). The feed sits on the page ground, not inside a card: each day is its own soft card under its header (one border level, H4). The controls sit above the feed, where they act (H5): the range (Today, Week, Month, Upcoming) and quick add on the first row, then the count, the type filter and the Mine toggle. A quiet "All tasks" link closes the feed.

### 13.5 Moment

A full-screen `--primary` ground that marks a real milestone, with a check, a Hero section title, one caption, an optional detail line, and one dismiss button. Only one moment exists today: **All clear**, when the last open item today is finished (`earnedAllClear`), at most once a day per device (`homeup-all-clear-shown`). Rules: never for routine completions, never more than once a day, never with a decision or second button, never confetti or loops. Any tap or Escape dismisses.

### 13.6 Spaces

On Home, below the feed, a micro label "Spaces" heads the section tiles (groceries, costs, setup and the rest). Each tile header leads with its section's 36px tile and a Title-step name. Spaces replaces a separate navigation tab: the tab bar keeps its sections, and Home shows their pulse.
