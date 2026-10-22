// HOUP-68: native port of the overflow `<Sheet>` inside
// apps/web/src/components/section-switcher.tsx's `SectionTabBar`.
//
// HOUP-142: web reaches a section's extra NavItems (Map View, Apartment
// Checklist, ...) through the persistent sidebar/drawer, which always shows
// the CURRENT section's navItems. Native has no such drawer, so this sheet
// opens with the active section's own navItems, the only surface that can
// reach them here.
//
// Below them (Guy's pick, Oct 21): a Recent strip of the last spaces you
// opened (core recent-sections.ts; never the bar's own or the one you're on),
// then every visible section as a 4-across tile grid, so a dozen modules fit
// without scrolling and each keeps a fixed spot. The bar's sections wear an
// outlined tile. Settings sits in the footer.
//
// Rearrange (Guy, Oct 21: "like iPhone home screen"): hold any tile and the
// grid jiggles; drag a tile to a new spot. The grid is the section order, so
// its first slots are the tab bar (core splitTabBar) and a drag in or out of
// them changes what's in the bar. Done (or closing the sheet) ends it. The
// header says "Hold an icon to rearrange" where Edit bar used to be.
// Web twin: apps/web/src/components/section-switcher.tsx's SpaceGrid.
import * as React from 'react';
import { Pressable, View, type AccessibilityActionEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { Settings } from 'lucide-react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import {
  Text,
  haptics,
  useHoldFill,
  useSheetDismissBlock,
  BottomSheet,
  BottomSheetScrollView,
  LeadingTile,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemTitle,
  ListItemTrailing,
  useThemeMaterial,
  useStillMotion,
} from '@homeup/ui';
import {
  MOTION_DURATIONS_MS,
  REARRANGE_HOLD_MS,
  SPACE_GRID_CELL_HEIGHT,
  moveItem,
  sectionHueSwatch,
  spaceGridCellOrigin,
  spaceGridRows,
  spaceGridSlotAt,
  splitTabBar,
  type NavItem,
  type Section,
} from '@homeup/core';
import { sectionIcons } from '@/lib/section-icons';

// A shared NavItem can point at a route that doesn't have a mobile screen
// yet — web has apps/web/src/app/map/page.tsx, mobile has no /map screen
// (deferred, per this ticket's audit). Drop it rather than link to a 404.
const UNAVAILABLE_ON_MOBILE = new Set(['/map']);

const MICRO_LABEL =
  'cap-inscription px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground';

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View className="min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1.5 py-0.5">
      <Text className="text-[10px] font-semibold leading-none text-white">{count}</Text>
    </View>
  );
}

const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);
// Each tile tips this far either way while the grid jiggles, one swing per
// `fast`. Neighbours start on opposite swings so the grid doesn't sway as one.
const JIGGLE_DEG = 1.6;
// A held tile lifts while it's dragged.
const LIFT_SCALE = 1.12;

interface SpaceTileProps {
  section: Section;
  index: number;
  count: number;
  cellWidth: number;
  editing: boolean;
  inBar: boolean;
  active: boolean;
  badge: number;
  scheme: ReturnType<typeof useThemeMaterial>['scheme'];
  onPress: () => void;
  /** The tile was picked up (by a hold, or a drag while editing). */
  onDragStart: (id: string) => void;
  /** The dragged tile's centre is over grid cell `slot`. */
  onDragMove: (id: string, slot: number) => void;
  onDragEnd: (id: string) => void;
  /** Screen readers: start rearranging, or step a tile one place. */
  onAccessibilityAction: (id: string, action: string) => void;
}

// One tile of the All spaces grid. It sits at its cell by transform (never
// by layout), so a reorder glides every tile to its new cell at base and
// the dragged one follows the finger 1:1 (Hearth §8 "Rearrange").
function SpaceTile({
  section,
  index,
  count,
  cellWidth,
  editing,
  inBar,
  active,
  badge,
  scheme,
  onPress,
  onDragStart,
  onDragMove,
  onDragEnd,
  onAccessibilityAction,
}: SpaceTileProps) {
  const Icon = sectionIcons[section.iconId];
  const swatch = sectionHueSwatch(section.id, scheme);
  const reduceMotion = useStillMotion();
  const hold = useHoldFill(REARRANGE_HOLD_MS);

  const origin = spaceGridCellOrigin(index, cellWidth);
  const x = useSharedValue(origin.x);
  const y = useSharedValue(origin.y);
  const dragging = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const slot = useSharedValue(index);
  const lift = useSharedValue(1);
  const tilt = useSharedValue(0);
  const [lifted, setLifted] = React.useState(false);

  // Glide to the cell this tile now holds, unless the finger has it. A new
  // grid width (first layout, rotation) places it without a glide.
  const placedWidth = React.useRef(cellWidth);
  React.useEffect(() => {
    slot.value = index;
    if (dragging.value) return;
    const o = spaceGridCellOrigin(index, cellWidth);
    if (placedWidth.current !== cellWidth || reduceMotion) {
      placedWidth.current = cellWidth;
      x.value = o.x;
      y.value = o.y;
      return;
    }
    const timing = { duration: MOTION_DURATIONS_MS.base, easing: SWIFT_OUT };
    x.value = withTiming(o.x, timing);
    y.value = withTiming(o.y, timing);
  }, [index, cellWidth, reduceMotion, slot, dragging, x, y]);

  React.useEffect(() => {
    if (editing && !reduceMotion) {
      const swing = index % 2 === 0 ? JIGGLE_DEG : -JIGGLE_DEG;
      const half = { duration: MOTION_DURATIONS_MS.fast, easing: Easing.inOut(Easing.quad) };
      tilt.value = withRepeat(withSequence(withTiming(swing, half), withTiming(-swing, half)), -1, true);
    } else {
      cancelAnimation(tilt);
      tilt.value = withTiming(0, { duration: MOTION_DURATIONS_MS.fast });
    }
  }, [editing, reduceMotion, index, tilt]);

  const editingRef = React.useRef(editing);
  editingRef.current = editing;
  const id = section.id;
  const begin = () => {
    hold.stop();
    setLifted(true);
    onDragStart(id);
  };
  const finish = () => {
    setLifted(false);
    onDragEnd(id);
  };

  // Before rearranging, a hold picks the tile up (and the sheet's scroller
  // keeps any drag that starts sooner); while rearranging, any drag does.
  // The sheet's dismiss pan waits for this one (useSheetDismissBlock).
  const pan = useSheetDismissBlock(
    (editing ? Gesture.Pan().minDistance(4) : Gesture.Pan().activateAfterLongPress(REARRANGE_HOLD_MS))
      .enabled(cellWidth > 0)
      .onStart(() => {
        startX.value = x.value;
        startY.value = y.value;
        dragging.value = 1;
        lift.value = withTiming(LIFT_SCALE, { duration: MOTION_DURATIONS_MS.fast });
        scheduleOnRN(begin);
      })
      .onUpdate((e) => {
        x.value = startX.value + e.translationX;
        y.value = startY.value + e.translationY;
        const over = spaceGridSlotAt(
          x.value + cellWidth / 2,
          y.value + SPACE_GRID_CELL_HEIGHT / 2,
          cellWidth,
          count
        );
        if (over !== slot.value) {
          slot.value = over;
          scheduleOnRN(onDragMove, id, over);
        }
      })
      .onFinalize(() => {
        if (!dragging.value) return;
        dragging.value = 0;
        // Lands in the cell it was last over (the grid has already moved the
        // others aside), the rest of the way at base.
        const o = spaceGridCellOrigin(slot.value, cellWidth);
        x.value = withTiming(o.x, { duration: MOTION_DURATIONS_MS.base, easing: SWIFT_OUT });
        y.value = withTiming(o.y, { duration: MOTION_DURATIONS_MS.base, easing: SWIFT_OUT });
        lift.value = withTiming(1, { duration: MOTION_DURATIONS_MS.base, easing: SWIFT_OUT });
        scheduleOnRN(finish);
      })
  );

  const tileStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { rotate: `${tilt.value}deg` },
      { scale: lift.value * (1 - 0.06 * hold.progress) },
    ],
  }));

  const label = [section.label, inBar ? 'in bar' : null, badge ? `${badge} overdue` : null].filter(Boolean).join(', ');
  const actions = editing
    ? [
        ...(index > 0 ? [{ name: 'earlier', label: 'Move earlier' }] : []),
        ...(index < count - 1 ? [{ name: 'later', label: 'Move later' }] : []),
      ]
    : [{ name: 'longpress', label: 'Rearrange spaces' }];

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          { position: 'absolute', left: 0, top: 0, width: cellWidth, height: SPACE_GRID_CELL_HEIGHT, zIndex: lifted ? 10 : 0 },
          tileStyle,
        ]}
      >
        <Pressable
          onPressIn={() => {
            if (!editingRef.current) hold.start();
          }}
          onPressOut={hold.stop}
          onPress={() => {
            // While rearranging a tap does nothing (Done ends it).
            if (!editingRef.current) onPress();
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          accessibilityLabel={label}
          accessibilityHint={editing ? 'Drag to move' : undefined}
          accessibilityActions={actions}
          onAccessibilityAction={(e: AccessibilityActionEvent) => onAccessibilityAction(id, e.nativeEvent.actionName)}
          className="flex-1 items-center gap-2 px-1 py-1.5"
        >
          {Icon && (
            <LeadingTile
              sectionId={section.id}
              Icon={Icon}
              size="xl"
              style={inBar ? { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: swatch.glyph } : undefined}
            />
          )}
          <View className="flex-row items-center gap-1">
            <Text
              numberOfLines={2}
              className={`shrink text-center text-[12px] leading-tight ${
                active ? 'font-semibold' : inBar ? 'font-medium text-muted-foreground' : 'font-medium text-foreground'
              }`}
              style={active ? { color: swatch.glyph } : undefined}
            >
              {section.label}
            </Text>
            {badge > 0 && <NavBadge count={badge} />}
          </View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

export interface SectionSwitcherSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sections to render as switch targets: every visible one, in order.
      The first of them are the tab bar's (core splitTabBar), drawn with an
      outlined tile. */
  sections: Section[];
  /** Saves a rearranged grid: every visible section's id, in its new order. */
  onReorder: (ids: string[]) => void;
  /** The Recent strip, most recent first (core pickRecentSections). */
  recentSections?: Section[];
  currentSectionId?: string;
  onSelect: (section: Section) => void;
  /** The active section's own navItems (may include the active section
      itself, whether or not it's also in `sections`). */
  currentSectionLabel?: string;
  currentSectionNavItems?: NavItem[];
  overdueCount: number;
  onSelectNavItem: (href: string) => void;
}

export function SectionSwitcherSheet({
  open,
  onOpenChange,
  sections,
  onReorder,
  recentSections = [],
  currentSectionId,
  onSelect,
  currentSectionLabel,
  currentSectionNavItems = [],
  overdueCount,
  onSelectNavItem,
}: SectionSwitcherSheetProps) {
  const router = useRouter();
  const { scheme } = useThemeMaterial();
  // Only worth its own group when there's actually something beyond the
  // section's single basePath entry to reach.
  const navItems = currentSectionNavItems.filter((item) => !UNAVAILABLE_ON_MOBILE.has(item.href));
  const showNavItemsGroup = navItems.length > 1;
  const sectionBadge = (section: Section) =>
    overdueCount > 0 && section.navItems.some((i) => i.badge === 'overdueTasks') ? overdueCount : 0;

  // Rearranging: `draft` is the grid's order while it differs from what's
  // saved (a drag in progress, or a save on its way back).
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Section[] | null>(null);
  const grid = draft ?? sections;
  const barCount = splitTabBar(grid).primary.length;
  const savedKey = sections.map((s) => s.id).join(',');
  React.useEffect(() => {
    setDraft((d) => (d && d.map((s) => s.id).join(',') === savedKey ? null : d));
  }, [savedKey]);
  React.useEffect(() => {
    if (!open) {
      setEditing(false);
      setDraft(null);
    }
  }, [open]);

  const [gridWidth, setGridWidth] = React.useState(0);
  const cellWidth = gridWidth / 4;

  const gridRef = React.useRef(grid);
  gridRef.current = grid;
  const editingRef = React.useRef(editing);
  editingRef.current = editing;
  const save = (next: Section[]) => {
    setDraft(next);
    onReorder(next.map((s) => s.id));
  };
  const onDragStart = () => {
    if (editingRef.current) {
      haptics.tick();
    } else {
      // The hold's charge already buzzed; this is its firm third beat.
      haptics.commit();
      setEditing(true);
    }
  };
  const onDragMove = (id: string, slot: number) => {
    const list = gridRef.current;
    const from = list.findIndex((s) => s.id === id);
    if (from === -1 || from === slot) return;
    haptics.tick();
    const next = moveItem(list, from, slot);
    // Ahead of the re-render, so a drop right after this sees it.
    gridRef.current = next;
    setDraft(next);
  };
  const onDragEnd = () => {
    haptics.commit();
    const list = gridRef.current;
    if (list.map((s) => s.id).join(',') !== savedKey) save(list);
  };
  const onTileAction = (id: string, action: string) => {
    if (action === 'longpress') {
      setEditing(true);
      return;
    }
    const list = gridRef.current;
    const from = list.findIndex((s) => s.id === id);
    const to = action === 'earlier' ? from - 1 : action === 'later' ? from + 1 : from;
    if (from === -1 || to < 0 || to >= list.length || to === from) return;
    save(moveItem(list, from, to));
  };
  const hasBarTiles = barCount > 0;

  const openPath = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="pb-4">
      <View className="flex-row items-center justify-between px-4 pb-3">
        <Text className="text-title font-medium text-foreground">More</Text>
        {editing ? (
          <Pressable accessibilityRole="button" onPress={() => setEditing(false)} hitSlop={8} className="p-1">
            <Text className="text-[13px] font-semibold text-primary">Done</Text>
          </Pressable>
        ) : (
          sections.length > 1 && <Text className="text-caption text-muted-foreground">Hold an icon to rearrange</Text>
        )}
      </View>

      {/* Short phones or more modules: the body scrolls under the fixed
          header instead of clipping. */}
      <BottomSheetScrollView scrollEnabled={!editing}>
        {showNavItemsGroup && (
          <View className="px-3 pb-3">
            {currentSectionLabel && <Text className={MICRO_LABEL}>{currentSectionLabel}</Text>}
            <ListGroup className="border-0 bg-transparent">
              {navItems.map((item) => {
                const Icon = sectionIcons[item.iconId];
                const showBadge = item.badge === 'overdueTasks' && overdueCount > 0;
                return (
                  <ListItem key={item.href} onPress={() => onSelectNavItem(item.href)}>
                    <ListItemLeading>
                      {Icon && <Icon size={20} className={item.accent ? 'text-primary' : 'text-muted-foreground'} />}
                    </ListItemLeading>
                    <ListItemContent>
                      <ListItemTitle className={item.accent ? 'text-primary' : undefined}>{item.label}</ListItemTitle>
                    </ListItemContent>
                    {showBadge && (
                      <ListItemTrailing>
                        <NavBadge count={overdueCount} />
                      </ListItemTrailing>
                    )}
                  </ListItem>
                );
              })}
            </ListGroup>
          </View>
        )}

        {recentSections.length > 0 && (
          <View className="px-4 pb-4">
            <Text className={MICRO_LABEL}>Recent</Text>
            <View className="flex-row gap-2">
              {recentSections.map((section) => {
                const Icon = sectionIcons[section.iconId];
                return (
                  <Pressable
                    key={section.id}
                    onPress={() => onSelect(section)}
                    accessibilityRole="button"
                    accessibilityLabel={section.label}
                    // Keeps a lone or paired chip at a third of the row, not stretched.
                    style={{ flexBasis: 0, flexGrow: 1, maxWidth: '33.34%' }}
                    className="min-h-[48px] flex-row items-center gap-2 rounded-2xl border border-border bg-card px-2.5 active:scale-[0.97]"
                  >
                    {Icon && <LeadingTile sectionId={section.id} Icon={Icon} size="sm" />}
                    <Text numberOfLines={2} className="flex-1 text-[13px] font-medium leading-tight text-foreground">
                      {section.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {grid.length > 0 && (
          <View className="px-3">
            {recentSections.length > 0 && <Text className={`${MICRO_LABEL} px-2`}>All spaces</Text>}
            <View
              onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
              style={{ height: spaceGridRows(grid.length) * SPACE_GRID_CELL_HEIGHT }}
            >
              {/* While rearranging, the bar's slots sit on a dock, like a
                  phone's home screen: drop a space here to put it in the bar. */}
              {editing && cellWidth > 0 && barCount < grid.length && (
                <View
                  pointerEvents="none"
                  className="absolute rounded-3xl bg-secondary"
                  style={{ left: 0, top: 0, width: cellWidth * barCount, height: SPACE_GRID_CELL_HEIGHT }}
                />
              )}
              {cellWidth > 0 &&
                grid.map((section, index) => (
                  // Same language as the tab bar (Hearth v2 H2, navigation):
                  // every section leads with its own identity tile, and the
                  // one you're on names itself in its glyph hue. A bar
                  // section's tile is outlined: it's already a tap away below.
                  <SpaceTile
                    key={section.id}
                    section={section}
                    index={index}
                    count={grid.length}
                    cellWidth={cellWidth}
                    editing={editing}
                    inBar={index < barCount}
                    active={section.id === currentSectionId}
                    badge={sectionBadge(section)}
                    scheme={scheme}
                    onPress={() => onSelect(section)}
                    onDragStart={onDragStart}
                    onDragMove={onDragMove}
                    onDragEnd={onDragEnd}
                    onAccessibilityAction={onTileAction}
                  />
                ))}
            </View>
          </View>
        )}

        <View className="mx-4 mt-3 flex-row items-center justify-between gap-3 border-t border-border pt-3">
          {editing ? (
            <Text className="flex-1 text-caption text-muted-foreground">
              Drag a space onto the dock to put it in your bar
            </Text>
          ) : hasBarTiles ? (
            <View className="flex-1 flex-row items-center gap-2">
              <View className="h-3.5 w-3.5 rounded-[5px] border-[1.5px] border-muted-foreground" />
              <Text className="text-caption text-muted-foreground">Outlined: already in your bar</Text>
            </View>
          ) : (
            <View className="flex-1" />
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => openPath('/settings')}
            className="min-h-[36px] flex-row items-center gap-1.5 rounded-full bg-secondary px-3 active:scale-[0.97]"
          >
            <Settings size={16} className="text-muted-foreground" />
            <Text className="text-[13px] font-medium text-foreground">Settings</Text>
          </Pressable>
        </View>
      </BottomSheetScrollView>
    </BottomSheet>
  );
}
