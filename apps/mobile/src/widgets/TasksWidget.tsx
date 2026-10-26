// Hearth v2 home-screen widget: Home's top in miniature. The lede ("3 of 7
// left today" with its segmented meter) and the weather, then the Upcoming
// feed grouped under Earlier / Today / Tomorrow / weekday headers, each row
// leading with its section's tile, then the Spaces footer (to buy, budget).
// Drawn by react-native-android-widget, which paints the tree to a bitmap,
// so the widget renders twice, a light and a dark version, and Android shows
// the one matching the phone's dark mode. Both resolve the theme picked in
// the app: "Match device" gives Ember Day and Ember Night, a pinned theme
// draws in that theme either way.
import * as React from 'react';
import { FlexWidget, ListWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import {
  THEME_TOKENS,
  WIDGET_SNAPSHOT_VERSION,
  DEFAULT_THEME_PREFERENCE,
  formatTime12h,
  meterSegments,
  oklchToHex,
  resolveThemePreference,
  sectionHueSwatch,
  themeHueScheme,
  todayISO,
  widgetFeedGroups,
  widgetRowWhen,
  widgetSections,
  widgetTodayProgress,
  widgetUndoTarget,
  SECTION_GLOW_OPACITY,
  type ThemeId,
  type ThemePreference,
  type WidgetGrocerySnapshotItem,
  type WidgetSummary,
  type WidgetTaskSnapshotItem,
} from '@homeup/core';
import { WIDGET_GLYPHS, type WidgetGlyph } from './widget-glyphs';

type Hex = `#${string}`;

function mixHex(from: string, to: string, amount: number): Hex {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) =>
    Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * amount)
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${out.join('')}`;
}

function paletteFor(themeId: ThemeId) {
  const c = THEME_TOKENS[themeId].colors;
  const scheme = themeHueScheme(themeId);
  const background = oklchToHex(c.background);
  const foreground = oklchToHex(c.foreground);
  const glow = sectionHueSwatch('home', scheme).glow;
  return {
    scheme,
    background,
    // Hearth v2 glow (13.1): Home's wash from the top right, flattened
    // into the ground because the widget's bitmap can't blend over the wallpaper.
    glow: mixHex(background, glow, SECTION_GLOW_OPACITY[scheme] * 0.45),
    card: oklchToHex(c.card),
    foreground,
    muted: oklchToHex(c['muted-foreground']),
    primary: oklchToHex(c.primary),
    primaryForeground: oklchToHex(c['primary-foreground']),
    destructive: oklchToHex(c.destructive),
    warning: oklchToHex(c.warning),
    success: oklchToHex(c.success),
    border: oklchToHex(c.border),
    // The lede meter's unfilled track: a faint foreground (H3).
    track: mixHex(background, foreground, 0.14),
  };
}

type Palette = ReturnType<typeof paletteFor>;

const palettes = new Map<ThemeId, Palette>();

function paletteForTheme(themeId: ThemeId): Palette {
  let palette = palettes.get(themeId);
  if (!palette) {
    palette = paletteFor(themeId);
    palettes.set(themeId, palette);
  }
  return palette;
}

const OPEN_HOME_URI = 'mobile://home';
const OPEN_TASKS_ADD_URI = 'mobile://tasks?add=1';
const OPEN_GROCERIES_URI = 'mobile://groceries';
const OPEN_COSTS_URI = 'mobile://costs';

function openUri(path: string | null): string {
  return path ? `mobile:/${path.startsWith('/') ? path : `/${path}`}` : OPEN_HOME_URI;
}

function glyphSvg(glyph: WidgetGlyph, color: string, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${WIDGET_GLYPHS[glyph]}</svg>`;
}

/** The row's glyph, as Home's feed picks it (task-row.tsx heroRowIcon, home's appointment rows). */
function rowGlyph(item: WidgetTaskSnapshotItem): WidgetGlyph {
  if (item.done) return 'check';
  if (item.type === 'appointment') return 'calendar-clock';
  switch (item.section) {
    case 'household':
      return item.type === 'reminder' ? 'alarm-clock' : 'list-todo';
    case 'calendar':
      return 'calendar-days';
    case 'costs':
      return 'wallet';
    case 'documents':
      return 'folder-open';
    case 'checklists':
      return 'list-todo';
    default:
      return 'layout-grid';
  }
}

/** Hearth v2 leading tile (13.0): the section's tile hue holding its glyph. Identity only, never its own tap target. */
function Tile(props: { section: string; glyph: WidgetGlyph; size: number; palette: Palette }) {
  const { section, glyph, size, palette } = props;
  const swatch = sectionHueSwatch(section, palette.scheme);
  const icon = Math.round(size * 0.5);
  return (
    <FlexWidget
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.31),
        backgroundColor: swatch.tile as Hex,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <SvgWidget svg={glyphSvg(glyph, swatch.glyph, icon)} style={{ width: icon, height: icon }} />
    </FlexWidget>
  );
}

function Lede(props: { items: WidgetTaskSnapshotItem[]; today: string; summary: WidgetSummary; showCount: boolean; palette: Palette }) {
  const { items, today, summary, showCount, palette } = props;
  const progress = widgetTodayProgress(items, today);
  const meter = meterSegments(progress.done, progress.total);
  const weather = summary.weather;
  return (
    <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end', width: 'match_parent' }}>
        <FlexWidget style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end' }}>
          {showCount &&
            (progress.left === 0 ? (
              <FlexWidget style={{ flexDirection: 'column' }}>
                <TextWidget text="All clear" style={{ fontSize: 26, fontWeight: '800', color: palette.foreground, letterSpacing: -0.8 }} />
                <TextWidget
                  text={progress.done > 0 ? `${progress.done} done today` : 'Nothing on today'}
                  style={{ fontSize: 12, color: palette.muted, marginTop: 1 }}
                />
              </FlexWidget>
            ) : (
              <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                <TextWidget
                  text={String(progress.left)}
                  style={{ fontSize: 40, fontWeight: '800', color: palette.foreground, letterSpacing: -1.6 }}
                />
                <TextWidget
                  text={`of ${progress.total} left today`}
                  style={{ fontSize: 14, fontWeight: '600', color: palette.muted, marginLeft: 6, marginBottom: 7 }}
                />
              </FlexWidget>
            ))}
        </FlexWidget>
        {weather && (
          <FlexWidget style={{ flexDirection: 'column', alignItems: 'flex-end', marginLeft: 8, marginBottom: 4 }}>
            <TextWidget
              text={`${Math.round(weather.tempC)}°`}
              style={{ fontSize: 20, fontWeight: '700', color: palette.foreground }}
            />
            <TextWidget
              text={weather.stale ? 'Last known' : weather.condition}
              truncate="END"
              maxLines={1}
              style={{ fontSize: 11.5, color: palette.muted }}
            />
          </FlexWidget>
        )}
      </FlexWidget>
      {showCount && progress.left > 0 && meter.count > 0 && (
        <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', marginTop: 6 }}>
          {Array.from({ length: meter.count }, (_, i) => (
            <FlexWidget
              key={i}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                marginLeft: i === 0 ? 0 : 5,
                backgroundColor: i < meter.filled ? palette.primary : palette.track,
              }}
            />
          ))}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

function FeedHeading(props: { count: number; canAdd: boolean; palette: Palette }) {
  const { count, canAdd, palette } = props;
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', marginTop: 12 }}>
      <FlexWidget
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
        clickAction="OPEN_URI"
        clickActionData={{ uri: OPEN_HOME_URI }}
      >
        <TextWidget text="Upcoming" style={{ fontSize: 18, fontWeight: '700', color: palette.foreground, letterSpacing: -0.3 }} />
        <TextWidget text={String(count)} style={{ fontSize: 14, color: palette.muted, marginLeft: 7 }} />
      </FlexWidget>
      {canAdd && (
        <FlexWidget
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: palette.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          clickAction="OPEN_URI"
          clickActionData={{ uri: OPEN_TASKS_ADD_URI }}
          accessibilityLabel="Add a task"
        >
          <SvgWidget svg={glyphSvg('plus', palette.primaryForeground, 16)} style={{ width: 16, height: 16 }} />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

function DayHeader(props: { label: string; earlier: boolean; first: boolean; palette: Palette }) {
  const { label, earlier, first, palette } = props;
  return (
    <FlexWidget style={{ width: 'match_parent', paddingTop: first ? 2 : 10, paddingBottom: 5, paddingHorizontal: 4 }}>
      <TextWidget
        text={label.toUpperCase()}
        style={{ fontSize: 10.5, fontWeight: '700', letterSpacing: 1.05, color: earlier ? palette.destructive : palette.muted }}
      />
    </FlexWidget>
  );
}

/** A tick's payload: the row's id and the state the widget drew it in (widgetTaskHandler's stale-render guard). */
function toggleTaskData(item: WidgetTaskSnapshotItem) {
  return {
    id: item.id,
    snapshotVersion: WIDGET_SNAPSHOT_VERSION,
    snapshotDone: item.done,
    snapshotSourceUpdatedAt: item.sourceUpdatedAt,
  };
}

/** After a tick from the widget: which task it changed, and a tap to reverse it. */
function UndoLine(props: { item: WidgetTaskSnapshotItem; palette: Palette }) {
  const { item, palette } = props;
  return (
    <FlexWidget
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        width: 'match_parent',
        backgroundColor: palette.card,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 7,
        marginTop: 6,
      }}
      clickAction="TOGGLE_TASK"
      clickActionData={toggleTaskData(item)}
      accessibilityLabel={`${item.done ? 'Finished' : 'Reopened'} ${item.title}, tap to undo`}
    >
      <FlexWidget style={{ flex: 1 }}>
        <TextWidget
          text={`${item.done ? 'Finished' : 'Reopened'} ${item.title}`}
          truncate="END"
          maxLines={1}
          style={{ fontSize: 12.5, color: palette.foreground }}
        />
      </FlexWidget>
      <TextWidget text="Undo" style={{ fontSize: 12.5, fontWeight: '700', color: palette.primary, marginLeft: 10 }} />
    </FlexWidget>
  );
}

/**
 * The row's tick: a ring that finishes the task, a filled check that reopens
 * it. The ring carries the identity mark (6, States): coral is yours, a
 * dashed amber seat nobody's.
 */
function TickCircle(props: { item: WidgetTaskSnapshotItem; palette: Palette }) {
  const { item, palette } = props;
  return (
    <FlexWidget
      style={{ paddingLeft: 10, paddingRight: 2, paddingVertical: 4 }}
      clickAction="TOGGLE_TASK"
      clickActionData={toggleTaskData(item)}
      accessibilityLabel={item.done ? `Reopen ${item.title}` : `Finish ${item.title}`}
    >
      {item.done ? (
        <FlexWidget
          style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: palette.success, alignItems: 'center', justifyContent: 'center' }}
        >
          <SvgWidget svg={glyphSvg('check', palette.primaryForeground, 14)} style={{ width: 14, height: 14 }} />
        </FlexWidget>
      ) : (
        <FlexWidget
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 2,
            borderStyle: item.assigned ? 'solid' : 'dashed',
            borderColor: item.assignedToMe ? palette.primary : item.assigned ? palette.muted : palette.warning,
          }}
        />
      )}
    </FlexWidget>
  );
}

function FeedRow(props: { item: WidgetTaskSnapshotItem; today: string; first: boolean; last: boolean; palette: Palette }) {
  const { item, today, first, last, palette } = props;
  const when = widgetRowWhen(item, today);
  const whenText = when ? (when.kind === 'overdue' ? when.text : formatTime12h(when.time)) : null;
  const meta = item.done ? 'Done' : whenText ? `${whenText} · ${item.sourceLabel}` : item.sourceLabel;
  // The row opens the item (a task opens focused in Tasks); only the tick
  // circle finishes a task, so a tick is a deliberate tap on its own target.
  const uri = openUri(item.openPath ?? (item.toggleable ? `/tasks?focus=${encodeURIComponent(item.id)}` : null));

  return (
    <FlexWidget
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        width: 'match_parent',
        backgroundColor: palette.card,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderTopLeftRadius: first ? 18 : 0,
        borderTopRightRadius: first ? 18 : 0,
        borderBottomLeftRadius: last ? 18 : 0,
        borderBottomRightRadius: last ? 18 : 0,
        // Hairline dividers inside the day's card (H4).
        borderTopWidth: first ? 0 : 1,
        borderTopColor: palette.border,
      }}
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      accessibilityLabel={item.title}
    >
      <Tile section={item.section} glyph={rowGlyph(item)} size={32} palette={palette} />
      <FlexWidget style={{ flex: 1, flexDirection: 'column', marginLeft: 10 }}>
        <TextWidget
          text={item.title}
          truncate="END"
          maxLines={1}
          style={{ fontSize: 14, fontWeight: '600', color: item.done ? palette.muted : palette.foreground }}
        />
        <TextWidget
          text={meta}
          truncate="END"
          maxLines={1}
          style={{ fontSize: 12, color: when?.kind === 'overdue' && !item.done ? palette.destructive : palette.muted, marginTop: 1 }}
        />
      </FlexWidget>
      {item.toggleable && <TickCircle item={item} palette={palette} />}
    </FlexWidget>
  );
}

// The feed is a ListWidget: a native list the launcher scrolls, one picture
// per day header and row. Our patch in patches/ places it, and the tap
// areas, by fractions of the box the launcher draws, so they stay on the
// picture when a launcher's box differs from the size it reports (Nova
// Launcher, the phone's Display size setting). Fractions need an APK from
// runtimeVersion 57.6; 57.4 and 57.5 place them in dp.
function Feed(props: { items: WidgetTaskSnapshotItem[]; today: string; palette: Palette }) {
  const { items, today, palette } = props;
  const children: React.ReactElement[] = [];
  widgetFeedGroups(items, today).forEach((group, g) => {
    children.push(
      <DayHeader key={`h-${group.key}`} label={group.label} earlier={group.key === 'earlier'} first={g === 0} palette={palette} />,
    );
    group.items.forEach((item, i) => {
      children.push(
        <FeedRow
          key={item.id}
          item={item}
          today={today}
          first={i === 0}
          last={i === group.items.length - 1}
          palette={palette}
        />,
      );
    });
  });
  return (
    <FlexWidget style={{ flex: 1, width: 'match_parent', marginTop: 6 }}>
      <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>{children}</ListWidget>
    </FlexWidget>
  );
}

function SpaceChip(props: {
  section: string;
  glyph: WidgetGlyph;
  text: string;
  uri: string;
  palette: Palette;
  meter?: { ratio: number; color: string };
}) {
  const { section, glyph, text, uri, palette, meter } = props;
  return (
    <FlexWidget
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: palette.card,
        borderRadius: 14,
        paddingLeft: 5,
        paddingRight: 10,
        paddingVertical: 5,
        marginRight: 8,
      }}
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
    >
      <Tile section={section} glyph={glyph} size={22} palette={palette} />
      <TextWidget text={text} style={{ fontSize: 12.5, fontWeight: '600', color: palette.foreground, marginLeft: 7 }} />
      {meter && (
        <FlexWidget style={{ height: 3, width: 36, borderRadius: 2, backgroundColor: palette.track, marginLeft: 7 }}>
          <FlexWidget
            style={{ height: 3, width: Math.max(2, Math.round(meter.ratio * 36)), borderRadius: 2, backgroundColor: meter.color as Hex }}
          />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

const money = (cents: number, symbol = '$') => symbol + Math.round(cents / 100).toLocaleString('en-US');

export interface TasksWidgetProps {
  items: WidgetTaskSnapshotItem[];
  groceries: WidgetGrocerySnapshotItem[];
  summary: WidgetSummary;
  /** The theme to draw in. Defaults to Ember Day. */
  themeId?: ThemeId;
}

export function TasksWidget(props: TasksWidgetProps) {
  const { items, summary, themeId = 'ember-day' } = props;
  const palette = paletteForTheme(themeId);
  const today = todayISO();
  const sections = widgetSections(summary, items.length);
  const budget = sections.costs ? summary.budget : null;
  const tone = { success: palette.success, warning: palette.warning, danger: palette.destructive };
  const openCount = items.filter((i) => !i.done).length;
  const showLede = sections.taskCounts || !!summary.weather;
  const showSpaces = sections.toBuyCount || !!budget;
  const undo = sections.tasks ? widgetUndoTarget(summary, items) : null;

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundGradient: { from: palette.glow, to: palette.background, orientation: 'TR_BL' },
        flexDirection: 'column',
        paddingHorizontal: 14,
        paddingTop: 14,
        paddingBottom: 12,
        borderRadius: 24,
      }}
      clickAction="OPEN_URI"
      clickActionData={{ uri: OPEN_HOME_URI }}
      accessibilityLabel="Rooftap, upcoming"
    >
      {showLede && (
        <Lede items={items} today={today} summary={summary} showCount={sections.taskCounts} palette={palette} />
      )}

      {sections.tasks && <FeedHeading count={openCount} canAdd={sections.tasks === 'tasks'} palette={palette} />}
      {undo && <UndoLine item={undo} palette={palette} />}
      {sections.tasks &&
        (items.length === 0 ? (
          <FlexWidget style={{ flex: 1, width: 'match_parent', marginTop: 8 }}>
            <TextWidget text="Nothing on the agenda." style={{ fontSize: 13, color: palette.muted }} />
          </FlexWidget>
        ) : (
          <Feed items={items} today={today} palette={palette} />
        ))}

      {sections.nothingToShow && (
        <FlexWidget style={{ flex: 1, width: 'match_parent' }}>
          <TextWidget text="Nothing to show here. Tasks and Groceries are off." style={{ fontSize: 13, color: palette.muted }} />
        </FlexWidget>
      )}

      {/* Hearth v2 Spaces (13.6): the sections' pulse under the feed, each opening its section. */}
      {showSpaces && (
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', marginTop: 10 }}>
          {sections.toBuyCount && (
            <SpaceChip
              section="groceries"
              glyph="shopping-cart"
              text={summary.toBuyCount > 0 ? `${summary.toBuyCount} to buy` : 'Nothing to buy'}
              uri={OPEN_GROCERIES_URI}
              palette={palette}
            />
          )}
          {budget && (
            <SpaceChip
              section="costs"
              glyph="wallet"
              text={`${money(budget.spentCents, budget.currencySymbol)} of ${money(budget.budgetCents, budget.currencySymbol)}`}
              uri={OPEN_COSTS_URI}
              palette={palette}
              meter={{
                ratio: budget.budgetCents > 0 ? Math.min(1, budget.spentCents / budget.budgetCents) : 0,
                color: tone[budget.tone],
              }}
            />
          )}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

/**
 * The light and dark renders; Android shows the one that matches the phone's
 * dark mode. Each resolves the app's theme preference for that mode.
 */
export function tasksWidgetRepresentation(
  props: Omit<TasksWidgetProps, 'themeId'>,
  preference: ThemePreference = DEFAULT_THEME_PREFERENCE,
) {
  return {
    light: <TasksWidget {...props} themeId={resolveThemePreference(preference, 'light')} />,
    dark: <TasksWidget {...props} themeId={resolveThemePreference(preference, 'dark')} />,
  };
}
