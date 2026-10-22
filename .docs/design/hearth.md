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
- **H2. Color has four jobs, never shared.** `--primary` means *interactive*: buttons, active states, links, focus rings, hold fills, the slide-to-finish thumb (coral under Ember). Status hues mean *state* in small doses: a word, a value, a dot, a 3px meter, never a filled block. **Section hues mean *identity*** (§13.0): each section owns one hue, and it appears in exactly two places, the section's leading tile and its glow. A section hue never colors text, buttons, borders, card fills, or meters. Primary is never "healthy". **The one ground exception:** a Moment (§13.5) fills the screen with `--primary`, because it is the product saying "done", and it is dismissed with one tap. **Sanctioned exception (navigation and capture, Guy, Hearth v2 polish):** section hues also carry identity in wayfinding chrome. Every tab glyph (native and phone web) wears its section's glyph hue; the active tab sits on a soft pebble in its tile hue (one shape that glides between tabs, §8 "Tab glide") with its label in its glyph hue, and inactive labels stay muted. The More tab is neutral until the active section lives behind it, then takes that section's hue. The desktop sidebar's section grid follows the same rule. More sheet rows and capture launcher tiles lead with the section's tile; the launcher's on-this-page tile is ringed in its glyph hue; add-as chip glyphs wear their section's glyph hue. The capture '+' stays `--primary` (H5). **Sanctioned exception (Settings menu, Guy, Oct 2026):** Settings menu rows lead with a coloured tile too. Section rows wear their section's hue; the other rows (General settings, Modules, Users, Appearance, Notifications, Integrations, About, What's new, Server) each wear a fixed hue from core's `SETTINGS_MENU_HUES`, passed to `LeadingTile` as `hue`. Sign out keeps its neutral tile with a destructive glyph. Nowhere else does a section hue color text, a border or a fill.
- **H3. Meters are local.** A progress bar is scoped to the thing it measures: tile-width in a tile, ~52px inline in a row, always ~3px tall. Edge-to-edge bars are reserved for page-level operations (uploads), never status. **v2:** a Hero lede may carry its own segmented meter under the number (one 3px segment per item, at most 10, finished ones in `--primary`, the rest a faint foreground track, 6px gaps; `meterSegments` in core) whenever there is anything to count. A scaled meter never rounds real progress away: one finish fills at least one segment, and the last fills only when everything is done. The Now card's checklist (§13.3) carries the same segmented meter, in `--success` like every checklist meter.
- **H4. One border level per view.** The outer card owns the chrome (border + shadow). Inside it: inset fills, hairline dividers, spacing. Card-in-card is a smell; if a child needs its own border it wants to be its own sibling. **v2:** the Home lede region has no card at all; it sits on the ground under the glow, and its pulse tiles are translucent cards (`bg-card/70`) so the glow reads through. The glow is ground, not a border level.
- **H5. Controls live with what they control.** A filter sits inside the surface it filters (e.g. the range picker is the list card's header), styled as a recessed track with a raised neutral thumb. Accent fills budget one per layer: the tab bar's capture "+" in chrome, at most one primary action in content. On Home the Now card's slide thumb is that one primary action.
- **H6. Numbers are typographic events.** Tabular figures, value-first, unit in muted small type (`$12,084 of $7,000`). Fragments over sentences ("9 on today", not "9 things on your agenda today"). Lucide over emoji. One middle dot per line, maximum. Relative dates over raw ISO, always ("tomorrow", "3d overdue", never "2026-07-16").

Copy bans (app UI): no em-dash anywhere in UI copy; no emoji in chrome (grocery produce glyphs and recipe method glyphs are content, see tenants); sentence case everywhere; no "smart/seamless" filler.

## 2. Mobile foundations (M1-M4)

- **M1. The thumb owns the bottom.** The tab bar's raised capture "+" anchors the thumb zone (do not add FABs; it already exists in `section-switcher.tsx` / `capture-buttons.tsx`). Screen-level primary actions stay in the bottom half. Rare/risky actions (customize, settings) live top-right, deliberately out of reach.
- **M2. 44px or it isn't a target.** Rows >= 55px, header buttons >= 42px, segments >= 34px inside a >= 44px track, toggles 40x24 with padded hit slop. Visual size can whisper; hit area never does. The slide-to-finish track is 56px tall with a 48px thumb.
- **M3. Gestures first, buttons as proof.** Rows act by swipe (right = complete, left = snooze) and hold (quick edit). The Now card acts by slide (drag the thumb to the end to finish) and pages by a sideways swipe on its top; chevrons beside its page dots are the visible path. Every gesture outcome also exists on a visible path: tap opens the item, the slide thumb is a real button (Enter/Space on web, the "activate" accessibility action on native), and finishing from the Now card shows a toast with Undo. No gesture-only features.
- **M4. Sheets, not modals.** Contextual UI arrives as a bottom sheet: grab handle, `safe-area-inset-bottom` padding, live controls (no Save button when a toggle can just apply). Center dialogs only for destructive confirms, and they are the app's own: ask through core's `dialog` store (`dialog.confirm`, `dialog.prompt`, `dialog.alert`), rendered by `DialogHost` (@homeup/ui on native, its web twin), never the OS's `Alert.alert`, `window.confirm` or `window.prompt`. The host fires `warn()` as a destructive confirm appears and `remove()` on its destructive button. A Moment (§13.5) is the one full-screen surface, and it carries no decisions.

## 3. Color roles

| Role | Token | Allowed uses |
|---|---|---|
| Accent (coral under Ember) | `--primary` | Capture button, active tab/segment text, links, focus rings, hold fills, toggles-on, slide thumb, lede meter segments, the Moment ground |
| Success (green) | `--success` | Completed, under budget, checklist meters, swipe-to-done reveal. Meters + small chips only |
| Warning (amber) | `--warning` | Due soon, unassigned, snooze reveal, approaching a limit, the Now card's "Now" eyebrow. The nudge color |
| Danger (red) | `--destructive` | Overdue, over budget, tab badges, destructive text, the feed's "Earlier" header. A dot, a word, a value, a 3px meter. Never a filled block |
| Section identity | `section-hues.ts` (`--hue-tile`, `--hue-glyph`, `--hue-glow` on web) | The section's leading tile and its glow. Nothing else |

**Section hues (v2).** Home coral, Tasks lilac, Groceries mint, Costs sun, Calendar sky, Recipes peach, Setup rose, Home search teal, Checklists lime, Shopper orchid, Rewards fern, Assistant indigo, Documents and Profile slate. Each hue has a light and a dark swatch (tile fill, glyph, glow) so it holds on both grounds. Feed rows take the hue of the section that owns the item (`heroItemSectionId`): a cost reminder wears the Costs tile on Home, a viewing wears Home search's.


Retired patterns: whole-card ownership tints (`cardAccent` in `task-row.tsx`) and colored rails; priority pills using warning/destructive fills; filled resting-state pills ("Needed"); **v2:** per-type tint rings in feed rows (`TYPE_STYLE` / `HERO_TYPE_STYLE`), replaced by the section tile. Identity of *people* lives in the trailing avatar (accent ring = you; dashed amber empty seat = unassigned). Priority is a tinted word in meta, not a pill.

**Chart series.** Category series in a chart (the Costs month bars and breakdown, the Home Budget Space) take one saturated hue each, spread evenly round the wheel (core `CATEGORY_COLOR`: blue, yellow, cyan, violet, pink, lime, orange, fuchsia, sky, slate) so neighbouring segments stay distinct. A series always sits next to its legend, so yellow or lime there never reads as warning or success; the series hues never leave the chart and its legend dots.

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

- **T1. Fonts are the constant, themes are the variable.** No per-section fonts, no per-theme fonts. Sections get identity from their tile, glyph and glow, never from type.
- **T2. The heading face is real.** `--font-heading` is bound in `layout.tsx` (Bricolage Grotesque 600-800 via `next/font`, `swap`) and registered in `globals.css`'s `@theme inline` block; native loads the same weights through `expo-font` and the tailwind preset (`BricolageGrotesque_800ExtraBold` for the Hero steps). Scoped to Hero, Display and Title steps only.
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
- **Archive and delete (chats and Scout searches, Guy 2026-10-22):** on an Assistant chat row or a Scout search row, swipe right archives (neutral reveal, an archived row moves back) and swipe left deletes (destructive reveal, `remove()`). Both leave a toast with Undo instead of a confirm. On web the same verbs sit in the row menu (§13.7) and both apps put them in the thread's header. Archived items wait under an "Archived" row at the end of their list. The Household thread never archives or deletes.
- **Slide to finish (v2, Now card):** the thumb follows the finger 1:1 and the track fills behind it; the label fades as the thumb travels. The thumb zips as it travels and crossing 82% of the travel (`SLIDE_FINISH_AT`) arms it with the zipper's firmest click (§9 Zipper). Releasing armed finishes: the thumb lands at the end, shows a check, `pop()`. Releasing short returns the thumb at base. As it lands the check pops (to ~1.16 and back, fast then base) and a small coral burst leaves the thumb (a thin ring that swells and fades, eight sparks that travel ~26px out and fade, over slow). After ~600ms the card leaves (exit, ease-in, fade and 16px drift left), the item is marked done, and the next queue item arrives in its place (slow, swift-out, fade up from a 16px drift). Reduced motion: no pop, burst, leave or arrive; the check shows for the same beat and the next card swaps in.
- **Page turn (Now card):** the drag follows 1:1 with resistance past the ends; a release past ~22% or a flick turns it, the rest animates at base; chevrons glide at base; no haptic (paging is travel).
- **Lede meter fill:** a newly filled segment sweeps in from its left edge at slow (scaleX, swift-out); an emptied one retreats at fast; mounting never animates.
- **Moment (v2):** the coral ground fades in at slow and the check scales in from 50% at slow; reduced motion shows it instantly with no scale. It never auto-dismisses and never loops.
- **Pull tab (bottom sheet):** open: sheet slides up at slow, backdrop fades at fast, the page behind draws back to ~96% scale and dims. Close: sheet leaves at 250ms ease-in, page draws back in at slow. Drag follows 1:1; flick past 30% dismisses; `tick()` crossing the dismiss line.
- **Tab glide (Guy, tab bar polish):** the tab bar's active highlight is one pebble behind the tabs, a gently lopsided rounded shape around the active tab's glyph and label (core `tab-glide.ts`: `TAB_GLIDE_SIZE`; web draws the outline with `tabBlobPath`, native draws a rounded view with uneven corners that `tabPebbleMetrics` stretches and leans with transforms only, since animated SVG broke on Android). On a tab change it rides the page shift's own timing (§8.1 Shift: `slow`, swift-out), never a separate spring: its centre is always exactly as far along the hop as the page has slid, and on that same progress it stretches into a droplet that thins as it goes, its crest leaning forward and its back drawn to a tail, widest early in the trip and back to rest as the page lands (`tabGlideEdges`, `TAB_GLIDE_STRETCH`). Web reads the glide straight off the page's Shift animation clock (`navShiftElapsedMs`); native starts it in the same JS turn the tab navigator starts the page, on the navigator's own transition spec. Its fill crossfades from the old section's tile hue to the new one on the same timing. Nothing may re-render the native tab navigator while it slides (it restarts the slide), so the (tabs) layout keeps the navigator memoized away from path and data changes. The glyph of the tab just arrived at pops once (to ~1.14 at fast, back at base); a tab that is active on first paint doesn't. Tabs squish to 0.94 while pressed. Reduced motion: the pebble jumps, no stretch, no pop. No haptic (switching tabs is travel).
- **Pop-up chat (Guy 2026-10-21):** the capture + wears the Rooftap roof mark (core `ROOFTAP_MARK`, one colour, `--primary-foreground` on `--primary`). With the assistant on, the + is also the way into the pop-up chat: a tap opens capture (which leads with a "Chat with Rooftap" row), a swipe up (the + follows the finger at 0.6, up to 36px, armed past 40px with a `tick()`, opens on release with `commit()`) or a hold (§9 "Hold to ask") opens the chat. The chat card grows out of the + (scale from 0.08 at its bottom centre, rising from the +'s centre, the +'s coral fading into the card over the first half; slow, swift-out) and minimising shrinks it back into the + (exit, ease-in). It sits over the current screen above a 40% scrim (10% on desktop, where it docks bottom right), lifts over the keyboard, and drags down by its handle to minimise. Minimised, the conversation stays; a reply that lands then lights the + dot (assistant glow) and shows the "Rooftap answered" banner with Open (Guy 2026-10-21: the dot alone was missed). The header's chats button swaps the thread for the list of chats (Household, kept chats, open quick asks, the latest closed ones, the same rows as the Assistant space); picking one opens it in the card, and "All chats" goes to the space. A load that fails or times out shows why with Try again instead of a skeleton that never ends. While a hold charges or a swipe climbs, the assistant's glow gathers round the + (its one dose of the assistant hue). Reduced motion: the card fades, the + doesn't scale or lift.
- **Household chat (Guy 2026-10-21):** the Household thread is the members' own chat room; Rooftap answers only a message that tags @Rooftap (core `wantsAssistantReply`), so the thinking dots show only then. Your messages sit right in the muted bubble; other members' sit left in a fainter bubble under their first name; Rooftap's replies stay unbubbled on the left, labelled Rooftap. While the thread is on screen it picks up what others write every few seconds, and the others get a push ("Name in Household") unless they had it open.
- **Tab slot pick (Guy, tab bar):** holding a tab for 450ms opens a sheet listing every section the household has on (bar ones marked In bar, hidden ones Hidden, the held one checked); picking one swaps the two in the saved section order (core `assignTabSlot`), so Settings > Navigation shows the same order. `commit()` when the hold fires, `select()` on a pick. The More sheet lists every visible section too, with the bar's own outlined, and rearranges them on a hold (below). Web times the pointer itself (iOS Safari has no long-press event) and also opens it on contextmenu.
- **Rearrange (More sheet, Guy 2026-10-21: "like iPhone home screen"):** the header says "Hold an icon to rearrange" (no Edit bar link). Holding any All spaces tile for 450ms (`REARRANGE_HOLD_MS`, core `space-rearrange.ts`) squeezes it to 0.94 while it charges (§9 Charge on native), then `commit()` and the grid starts rearranging: every tile tips ±1.6° on a loop, one swing per fast, neighbours on opposite swings (the one sanctioned loop besides skeletons, and only while rearranging), the header shows Done, and the bar's slots sit on a dock (a `--secondary` rounded ground behind the first cells; the grid is the section order, so the first `splitTabBar` slots are the bar). The held tile lifts to 1.12 and follows the finger 1:1 straight away; on native and touch web the same hold carries on into the drag. While rearranging any drag picks a tile up (`tick()`), the others glide aside at base, each new cell it passes `tick()`s, and the drop lands it at base with `commit()`; the order saves on drop (core `reorderVisibleSections`, hidden sections keep their places). Taps do nothing while rearranging; Done or closing the sheet ends it. Screen readers get Rearrange, then Move earlier / Move later actions; web takes arrow keys. Reduced motion: no tip, no glide.
- **Ghost reply (Guy 2026-10-21, "D seems more natural"):** while the assistant works on a reply, three faint lines (`--muted-foreground` at 15%, 12px tall, fully rounded) sit where the answer will appear, at 92%, 78% and 54% of the column. Each grows from the left to its width over 2.4s (swift-out), 1.1s after the one before, so a long wait still shows movement and nothing looks finished early. Once grown, each shimmers like a skeleton (opacity 1 to 0.45 over 2s, alternating), the sanctioned wait loop. The reply replaces the lines when it lands. Tokens in core `tokens.ts` (`GHOST_REPLY_*`); web `.ghost-line`. Reduced motion: the lines sit at full width, still.
- **Streamed reply (HOUP-509):** while tools run, one muted line under the ghost lines says what Rooftap is doing (`text-muted-foreground`, 13px, e.g. "Checking Groceries", or the change as its proposal card words it). Once the answer starts arriving its text replaces the ghost lines in place, in the reply's own type, growing as it is written; no cursor, caret or per-word animation. A lead-in the model writes before using a tool ("Let me check your list") stays on screen, with the status under it, until the answer's first words replace it, and never sooner than its reading time (core `leadInDwellMs`, 1.2 to 3 s after its last words arrived); nothing else is held back. The stored reply swaps in when it lands, so nothing moves. A server or model that can't stream keeps the ghost lines and status until the whole reply lands.
- **Pop out, pop in (Guy 2026-10-21, re-add suggestions):** tapping a "Might be running low" chip fires `tick()` and the chip pops out: it swells to 1.08 at fast (swift-out) and vanishes to 0.6 at fast (ease-in). Only then is the item re-added, and its row pops into its aisle: from 0.94 and transparent, past 1.015 at fast, to rest at base (swift-out). Add all and a Review row's Add pop their rows in the same way. Tokens in core `tokens.ts` (`POP_OUT_*`, `POP_IN_*`); native `usePopOut`/`PopIn` in `@homeup/ui`, web `.chip-pop-out`/`.row-pop-in`. Reduced motion: the item is added at once and nothing scales.
- **Hold to edit:** 100ms grace (`fillDelayMs`), fill sweeps from both ends over ~400ms charging as it goes (§9 Charge), `commit()` when it fires, menu pops at base (scale 0.97 to 1). Early lift retreats the fill at fast with no haptic (nothing changed).

The section glow is ground, not page (Guy, tab bar polish): it never shifts or fades with a page. **Glow drift (Guy, 2026-10-22):** on a section change it drifts along the top to the new section's place and blends into its hue. Its place follows the bar's order (core `glowDriftX`): the first section glows from the top left, the last from the top right, so the glow travels the same way the page slides. It runs on the page shift's clock, so the page, the pebble and the glow move as one (Guy found a slower glow out of sync). Web paints it once behind the routed region, outside the `route-content` group, and transitions the registered `--glow-hue` and `--glow-x`; native paints it once behind every section root (`TabGround` in the (tabs) layout, whose roots' `ScreenBackground` stay clear) and moves a band holding static glows. There the new hue rises over the first half while the old one holds, then the old one fades, so the wash never dims halfway. A theme's aura stays still under the drifting wash. A root's borrowed glow (Home's open lens) blends the same way, in place. Reduced motion: it swaps.

**Navigation speed (Guy, 2026-10-22):** a device-local choice in Settings > Appearance > Animation speed (core `nav-speed.ts`). Fast (the default) runs the page shift at `slow` (300ms); Smooth runs it at 550ms. The page shift, the tab bar's pebble and the section glow all read this one clock (`useNavShiftMs` on native, `--motion-nav` on web), so they never drift apart. Other motion (sheets, toasts, pops) keeps its own tokens. Reduced motion and E-Ink still make it instant.

### 8.1 Navigation choreography

Route changes use the browser View Transitions API (`document.startViewTransition()`, wrapped by `src/lib/view-transitions.ts`), not React's `<ViewTransition>` component, which needs a `react@canary` build this repo doesn't carry. Unsupported browsers, and `prefers-reduced-motion`, both fall back to a plain instant navigation.

The routed content wrapper (`app-sidebar.tsx`'s `.route-transition-region`) carries the route's named transition group (`route-content`); the sidebar, top bar, tab bar and the section glow behind the region stay in the unnamed root group with `animation: none`. Chrome never animates, on every navigation type, with two exceptions, both in step with the page: the tab bar's pebble glides to the new tab (§8 "Tab glide"), and the section glow drifts to the new section's place and hue (§8, §13.1). The phone tab bar's raised "+" has its own still group (`capture-fab`) so the shifting page never paints over it.

| Behavior | Trigger | Motion |
|---|---|---|
| **Shift** | Lateral tab switch (section change) between two sections in the bar | The page moves the way the tab bar's pebble travels. Toward the end of the bar (`shift-forward`): the old page slides left while the new one comes in from the right; back toward the start (`shift-back`) mirrors it. Distance `--nav-shift`, 60% of the width (core `TAB_SHIFT_FRACTION`) capped at 280px, clipped to the content region. The fade comes late so the page reads as moving, not crossfading (Guy 2026-10-22): the old page is gone 85% of the way along its travel and the new one starts to show 15% of the way along its own (core `TAB_SHIFT_FADE_AT`); `--motion-slow`, swift-out. Direction comes from the bar's order (`tabTravelDirection`). Native does the same through the tab navigator, whose screens are ranked in the bar's order. |
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
| `success()` | success notification | 12, 60, 12 | task completed (swipe), a grocery marked got, save landing |
| `warn()` | warning notification | 10, 50, 10 | destructive confirm appearing, budget crossing its limit while editing |
| `error()` | error notification | 16, 40, 16, 40, 16 | a save or action that failed (error toasts fire it) |
| `remove()` | rigid impact | 22 | the delete itself, after any confirm |
| `celebrate()` | light, medium, heavy roll into success | 8, 60, 10, 60, 14, 90, 12, 60, 12 | big finishes: a checklist reaching 100%, the grocery list cleared, the All clear Moment |
| `pop()` | a 120ms full-strength thump, then a 35ms kick (Android motor; iOS heavy impact into success) | 120, 50, 35 | slide to finish landing, the payoff of the zipper |

**Effects** ride a gesture instead of answering one event (Guy, 2026-10-19, haptics pass):
- **Charge (hold to edit):** `useHoldFill` buzzes `charge()` as the fill passes `HOLD_CHARGE_STEPS` (soft, then light), so the caller's `commit()` lands as the third and firmest beat. A lift before a step is silent; a retreating fill never buzzes.
- **Zipper (slide to finish, Guy 2026-10-21: "super granular, increasingly buzzy, finishing in a satisfying loud pop", "as if the slider physically resists me", and the thumb still follows the finger exactly):** the thumb buzzes `zipper()` at each of the 28 `SLIDE_ZIPPER_STEPS`, whose gaps shrink from ~5% of the track to under 1%, and each pulse is longer than the last (`slideZipperPulseMs`, 6ms taps to 40ms buzzes), so a steady drag grinds up into one continuous buzz at the threshold (which buzzes hardest). Releasing armed lands `pop()`. At most one buzz per frame (a flick buzzes the furthest step crossed), and dragging back over a step doesn't repeat it. On Android both use the motor at full default strength (React Native `Vibration`): Expo's `impactAsync` there is a soft 43-60ms buzz and the system click primitives are tuned to whisper, both too weak for this. Length carries the climb because JS can't grade the motor's strength. iOS steps through soft, light, medium, rigid, heavy impacts; web vibrates the same lengths.
- **Hold to ask (the capture +):** holding the + plays the zipper squeezed into the hold (`askHoldZipperMs`: silent for the first 140ms so a tap stays quiet, then the 28 steps up to just before `ASK_HOLD_MS`, 560ms), and the hold lands `pop()` as the chat opens. Letting go early stops the ramp.
- **Disarm (swipe rows):** pulling a swipe back under its trigger line clicks `select()`, softer than the `tick()` that armed it.

A Moment lands with `celebrate()` as it appears, after the `success()` the finishing gesture already fired. Every pulse obeys the device-local **Haptics** switch (Settings > Appearance; `setHapticsEnabled`). `navigator.vibrate` is Android-only (iOS Safari no-ops): a haptic is always a bonus layered on visible feedback, never the only signal. Reduced motion does NOT disable haptics. Tab switches, page turns and other pure navigation stay silent.

## 10. Themes

Hearth is composition; it must survive every theme untouched. Themes own hue, radius, texture, shadow. Hearth owns hierarchy, meter scale, spacing rhythm, accent discipline.

**v2 roster: six themes in three pairs, plus E-Ink.** The Axis Mundi pair (gilt, masonry, Cinzel capitals, the meridian) was retired in Oct 2026; a stored Axis preference falls back to Match device.

| Pair | Ids | Character |
|---|---|---|
| **Ember** (default) | `ember-day`, `ember-night` | Coral `--primary`, warm paper (day) and warm ink (night) grounds, a rounder radius (1.125rem), the section glow on. |
| **E-Ink** | `e-ink` | For e-paper screens (§10.2). Neutral greys, `--primary` is ink, a 0.75rem radius. Flat and still. |
| **Sorbet** | `sorbet-day`, `sorbet-night` | The playful pastel pair (§10.3). Mango `--primary` with dark text, gummy section hues, a rainbow aura, a 1.75rem radius, Fredoka on the Hero. |
| **Lavender** | `lavender-day`, `lavender-night` | The dreamy pastel pair (§10.3). Violet `--primary`, lilac and plum grounds, an opal aura, a 1.5rem radius, Fraunces on the Hero. |

**The setting is a preference, not a theme** (`packages/core/src/theme-preference.ts`). Appearance lists the theme families (Ember, Sorbet, Lavender, E-Ink) and a Light / Dark / Auto switch above them. The mode applies to whichever family is picked: Auto follows the phone or browser's light/dark setting, Light and Dark pin a variant. E-Ink has one variant and wears it in every mode. The default is Ember on Auto. The preference is stored as one `family:mode` string under `homeup-theme-pref`; values saved before the switch (`system`, or a theme id) still parse. Both platforms and the Android widget resolve through `resolveThemePreference`, so they never disagree.

### 10.1 Axis Mundi (retired)

The Axis Mundi pair and its meridian, Cinzel capitals and gilt accent split were removed. `.cap-inscription` stays as the group-label class and now reads the body face on every theme. The `--axis` colour token stays in every theme for the identity ring.

### 10.2 E-Ink

One light theme for e-paper phones, tablets and readers. E-paper redraws slowly and ghosts every in-between frame, so the theme is **flat** and **still**. Both apps gate on core's `isStillTheme`, never on the id.

- **Flat.** No section glow, no card shadow, no blur, no gradient. One border level stays, as everywhere.
- **Still.** Every motion token is 0ms. Tab glide, the page shift, the Now card burst and the moment's zoom are off, as under the device's reduced-motion setting. Native: `ThemeProvider` mounts Reanimated's `ReducedMotionConfig` and components branch on `useStillMotion()`. Web: the `--motion-*` tokens collapse, animations and transitions are cut, and `runNavTransition` skips the View Transition.
- **Grey identity.** Every section tile wears one grey (`INK_HUE_SWATCH`, hue scheme `ink`). Grocery art draws in greys. Cost categories take a grey ramp, and the stacked chart adds a pattern per category.
- **Status by words.** The status hues are greys, so a status still needs its word ("2 overdue"), as H2 already asks.

### 10.3 Sorbet and Lavender

Two pastel pairs, picked by Guy on 2026-10-22 from the pastel theme proposals. They change colour, radius, the glow and one face. Layout and every H rule stay.

- **Own hue sets.** Each pair wears its own swatches for the thirteen section hues (`HUE_SETS` in core `section-hues.ts`, hue scheme = the theme id). Sorbet pushes them to gummy chroma; Lavender softens them and moves Home from coral to orchid. `hueSchemeTone()` gives the ground (light or dark) wherever code needs it.
- **Aura.** A fixed three-layer wash (`GLOW_AURA`) sits under the section glow and is the same on every section: pink, aqua and lemon for Sorbet, lilac, ice blue and pink for Lavender. It is still the surface's one decorative element. The glow runs louder here (`SECTION_GLOW_OPACITY`).
- **Hero face (T1 deviation, signed off with the pick).** Only the Hero steps change face: Fredoka 700 for Sorbet, Fraunces 700 for Lavender. Web: `[data-theme^=...] .text-hero`. Native: the per-theme `--font-hero` var (`theme-vars.ts`), read by the `.text-hero*` utilities in the Tailwind preset. Display, Title and Body stay Bricolage and Geist.
- **Sorbet's accent.** Mango is light, so `--primary-foreground` is dark ink. As text (link verbs) it is softer than coral; keep link verbs short and next to what they act on.

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
- **Compact section head (Groceries, Guy's sign-off 2026-10-20):** a screen whose list is the work can drop the micro label and use the inline Hero lede (`layout="inline"`): the number, its label and caption stacked beside it, and the screen's actions at the row's end (one or two direct shortcuts, More, then Add). Secondary controls go in an `ActionMenu` (More; a list-view menu beside search, with a coral dot while a filter hides rows). Once the lede scrolls away a slim collapsed bar takes over: the count in the Display step with its label and caption, then the screen's top shortcuts and a round Add. Totals that aren't the lede move to a summary card at the end of the list ("This trip"), not a pulse strip.
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

A soft radial wash of the current section's glow hue from the top of the screen, behind content, about 420px tall, fading to nothing. Under the tabs it sits at the section's place in the bar's order, from the top left for the first section to the top right for the last; elsewhere (a pushed screen, a sheet) it rests in the top right. Strength is per scheme (stronger on dark ground). One glow per screen, always the current section's (or the one its root borrows); it holds still while content scrolls and pages shift over it, and its only motion is the drift into the next section's place and hue on a section change (§8 "Glow drift"). Every theme except E-Ink (§10.2). Never put a second glow inside a card.

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

### 13.7 Desktop shell (Guy, 2026-10-21)

From the `md` width up, the web app runs under a **top bar** instead of the phone's tab bar (`components/top-bar.tsx`). It holds, left to right: the Rooftap mark, every visible space as its glyph in its glyph hue (the navigation exception in H2), then Settings and the profile menu (name, theme, sign out). Each space sits in a fixed slot, so nothing moves when a name appears: the active space's short name shows under its glyph, and hovering or focusing another shows that name in its place (one name at a time). The active slot rides the same pebble as the phone bar (§8 "Tab glide"), gliding sideways on the page's Shift clock. A space with more than one page (Groceries' Item Library, Checklists' Templates) shows them as a row of links under the bar. Settings screens get the settings menu as their own left column.

The roof + docks at the bottom right of the screen (`DockCaptureFab`), with the phone +'s tap, hold and swipe; capture and the pop-up chat open out of it as docked cards, like a messenger window, and toasts stack above it.

From the `lg` width up, pages lay out as boards (`useWideLayout`): wider containers and columns where the content has them. On Home the lede sits beside the day ribbon (always open on a wide screen) and the Now card, which finishes with a "Mark done" button instead of the slide; the feed becomes a **week board** (core `weekBoardColumns`): one column per day from today, each headed by its date number, its day label and that day's forecast (`WeatherData.days`), with Earlier leading and Later and No date closing it, scrolling sideways past the fifth or so column. Spaces stay below, as on the phone. A narrow column wraps row titles and shows an assignee as their avatar alone.

Right-click on a row opens its hold menu at the pointer (`PopMenu` anchors to the last right-click inside its row).

Settings > Appearance > "Layout on wide screens" switches a browser back to the classic sidebar with one-column pages (`lib/desktop-layout.ts`, mirrored on `<html data-layout>` before first paint). Phones and the native app are unchanged: the Expo app ships for portrait phones, so the desktop shell has no native twin.
