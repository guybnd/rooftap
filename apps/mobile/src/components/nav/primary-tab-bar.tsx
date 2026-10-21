// HOUP-68: native port of apps/web/src/components/section-switcher.tsx's
// `SectionTabBar` (decision 3: primary tab set + section-switcher sheet, 10
// sections exceed a native tab bar). This is a hand-rolled overlay, not
// Expo Router's `Tabs` — Tabs (React Navigation bottom-tabs under the hood)
// has no built-in way to host a raised center FAB column the way the web
// bar does, so the same 2-left / FAB-column / 2-right(+More) layout is
// reproduced directly here and driven by `usePathname()` (mirrors web's
// `getSectionByPath`) rather than by a tab navigator's own active-route state.
//
// HOUP-142: previously called bare getEnabledSections() (declaration order,
// no hidden filter) — the Settings > Navigation panel's order_sections /
// hidden_sections were persisted but silently inert here. Now mirrors
// apps/web/src/components/app-sidebar.tsx (useTabBarSections, shared with
// the (tabs) navigator so page slides follow the bar's order). Also now
// sources overdueCount (Tasks tab + More sheet badges)
// and hands the active section's own navItems to the More sheet — the only
// surface that can reach them, since native has no persistent drawer.
//
// Holding a tab opens TabSlotPickerSheet to choose what sits in that slot
// (core assignTabSlot, saved as the same section_order Settings > Navigation
// edits). The More sheet lists every section, the bar's ones marked.
import * as React from 'react';
import { Pressable, View, type LayoutRectangle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { MoreHorizontal } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, cn, haptics, MeridianAxis, TabGlide, useThemeMaterial } from '@homeup/ui';
import {
  MOTION_DURATIONS_MS,
  assignTabSlot,
  initRecentSections,
  pickRecentSections,
  recordRecentSection,
  sectionHueSwatch,
  splitTabBar,
  useAssistantUnread,
  useModules,
  useRecentSectionIds,
  type Section,
  type SectionHueSwatch,
} from '@homeup/core';
import { useOverdueTaskCount } from '@homeup/core/src/hooks/use-overdue-task-count';
import { useCapture } from '@/components/capture/capture-context';
import { useDataCache } from '@/lib/data-cache';
import { nativeStoreEnvironment } from '@/lib/legend/environment';
import { perfMark } from '@/lib/perf-log';
import { sectionIcons } from '@/lib/section-icons';
import { useOpenRoute } from '@/lib/tab-routes';
import { CaptureFab } from './capture-fab';
import { SectionSwitcherSheet } from './section-switcher-sheet';
import { TabSlotPickerSheet } from './tab-slot-picker-sheet';
import { useTabBarSections } from './use-tab-bar-sections';

const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);

// The More sheet's Recent strip reads this device's list from the
// synchronous kv-store, so it's there on the sheet's first frame.
initRecentSections(nativeStoreEnvironment.keyValue);

// A tap's onPress follows its onPressIn well within this; a screen-reader
// activation has no onPressIn at all.
const PRESS_IN_HANDLED_MS = 2000;

// Hold this long on a tab to choose what sits in its slot.
const SLOT_PICK_HOLD_MS = 450;

function OverdueBadge({ count }: { count: number }) {
  return (
    <View className="absolute -top-0.5 right-1 h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1">
      <Text className="text-[9px] font-semibold leading-none text-white">{count}</Text>
    </View>
  );
}

// Hearth v2 (H2, navigation): one tab's glyph + label. The glyph always
// wears its section's identity hue (`hue`, core section-hues.ts, swatched
// for the theme's ground); the active tab sits on the bar's gliding pebble
// (TabGlide, drawn by the bar) in its own tile hue with its label in the
// glyph hue, inactive labels stay muted. The glyph of a tab just arrived at
// pops once (Hearth §8 "Tab glide"); being active on first paint doesn't.
// `hue` undefined = a neutral tab (More with nothing of its own active).
// Web twin: apps/web/src/components/section-switcher.tsx's SectionTabBar.
function TabFace({
  Icon,
  label,
  active,
  hue,
  badge,
}: {
  Icon: React.ComponentType<{ size?: number; color?: string; className?: string }> | undefined;
  label: string;
  active: boolean;
  hue: SectionHueSwatch | undefined;
  badge: number | null;
}) {
  const reduceMotion = useReducedMotion();
  const pop = useSharedValue(1);
  const wasActive = React.useRef(active);
  React.useEffect(() => {
    if (active && !wasActive.current && !reduceMotion) {
      pop.value = withSequence(
        withTiming(1.14, { duration: MOTION_DURATIONS_MS.fast, easing: SWIFT_OUT }),
        withTiming(1, { duration: MOTION_DURATIONS_MS.base, easing: SWIFT_OUT })
      );
    }
    wasActive.current = active;
  }, [active, reduceMotion, pop]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <>
      <View className="relative h-7 w-12 items-center justify-center">
        <Animated.View style={popStyle}>
          {Icon && (hue ? <Icon size={20} color={hue.glyph} /> : <Icon size={20} className="text-muted-foreground" />)}
        </Animated.View>
        {badge != null && <OverdueBadge count={badge} />}
      </View>
      <Text
        className={cn('text-[10px] leading-none', active ? 'font-semibold' : 'font-medium text-muted-foreground')}
        style={active && hue ? { color: hue.glyph } : undefined}
      >
        {label}
      </Text>
    </>
  );
}

type Slot = Pick<LayoutRectangle, 'x' | 'y' | 'width' | 'height'>;

export function PrimaryTabBar() {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [slotPick, setSlotPick] = React.useState<Section | null>(null);
  const openRoute = useOpenRoute();
  const insets = useSafeAreaInsets();
  const { group, updateUserSettings, isOnline } = useDataCache();
  // Holding + offers Ask while the assistant is on (capture-fab.tsx).
  const canAsk = useModules().isEnabled('assistant') && isOnline;
  const assistantUnread = useAssistantUnread();
  const { openCapture } = useCapture();
  const overdueCount = useOverdueTaskCount(group?.id);
  // Which swatch of each section hue the bar wears: the theme's ground
  // (Ember Day/Axis Day light, Ember Night/Axis Night dark).
  const { scheme } = useThemeMaterial();
  const { pathname, currentSection, orderedSections, hiddenSections, visibleSections: enabledSections } =
    useTabBarSections();
  const currentSectionId = currentSection.id;
  React.useEffect(() => {
    recordRecentSection(currentSectionId);
  }, [currentSectionId]);
  const recentIds = useRecentSectionIds();

  // Fixed 2*+*2 split, mirrors SectionTabBar: 4 visible sections render all
  // inline (2 left + 2 right), otherwise 3 primary (2 left + 1 right) and the
  // rest overflow into the "More" sheet.
  const { primary, overflow } = splitTabBar(enabledSections);
  const barSectionIds = new Set(primary.map((s) => s.id));
  // The bar's own are a tap away already, and so is the one you're on.
  const recentSections = pickRecentSections(recentIds, enabledSections, new Set([...barSectionIds, currentSectionId]));
  const leftTabs = primary.slice(0, 2);
  const rightPrimary = primary.slice(2);
  // The active section, when it lives behind More: the More tab then wears
  // that section's hue, so the bar still says where you are.
  const activeOverflow = overflow.find((s) => s.id === currentSectionId);
  const moreActive = !!activeOverflow;

  // The active section's navItems beyond its own basePath (e.g. Home
  // Search's Map/Appointments/Apartment Checklist) — the More sheet is the
  // only place native can surface these, so it must open even when the
  // active section itself isn't in `overflow` (i.e. it's a primary tab).
  const currentSectionExtraNavItems = currentSection.navItems.filter((item) => item.href !== currentSection.basePath);
  const showMoreTab = overflow.length > 0 || currentSectionExtraNavItems.length > 0;
  const moreHasOverdueBadge =
    overdueCount > 0 && overflow.some((s) => s.navItems.some((i) => i.badge === 'overdueTasks'));

  const goTo = (section: Section) => {
    // HOUP-203: re-tapping the tab you're already on shouldn't replay a full
    // navigation (remount + transition) — no-op, matching native tab bars.
    if (section.basePath === pathname) return;
    perfMark('nav:press', section.basePath);
    // HOUP-240 stacked a new screen instance per tab tap; `navigate` didn't
    // fix that (it only reuses the route already on top). Section roots are
    // now a Tabs group that keeps each one mounted; openRoute switches tabs
    // in place, or pops back to the group from a detail screen.
    openRoute(section.basePath);
  };

  const pressedInAt = React.useRef(0);

  const chooseForSlot = (slot: Section, chosen: Section) => {
    setSlotPick(null);
    const ids = orderedSections.map((s) => s.id);
    const next = assignTabSlot(ids, hiddenSections, slot.id, chosen.id);
    // Same array back = nothing to move (the section already in the slot).
    if (next.order === ids) return;
    void updateUserSettings(
      next.hidden.length === hiddenSections.length
        ? { section_order: next.order }
        : { section_order: next.order, hidden_sections: next.hidden }
    );
  };

  // Hearth §8 "Tab glide": one pebble behind the bar travels to whichever
  // tab is active (a primary tab, or More when the active section lives
  // behind it). Tabs report their boxes relative to their group, the groups
  // relative to the bar, which together place the active face.
  const [slots, setSlots] = React.useState<Record<string, Slot>>({});
  const recordSlot = React.useCallback((key: string, { x, y, width, height }: LayoutRectangle) => {
    setSlots((prev) => {
      const p = prev[key];
      if (p && p.x === x && p.y === y && p.width === width && p.height === height) return prev;
      return { ...prev, [key]: { x, y, width, height } };
    });
  }, []);
  const activeKey = moreActive ? 'more' : primary.some((s) => s.id === currentSectionId) ? currentSectionId : null;
  const activeTab = activeKey ? slots[`tab:${activeKey}`] : undefined;
  const activeGroup = activeKey
    ? slots[leftTabs.some((s) => s.id === activeKey) ? 'group:left' : 'group:right']
    : undefined;
  // The face sits between the tab's pt-1.5 and pb-2, a pixel above centre.
  const glideTarget =
    activeTab && activeGroup
      ? {
          cx: activeGroup.x + activeTab.x + activeTab.width / 2,
          cy: activeGroup.y + activeTab.y + activeTab.height / 2 - 1,
        }
      : null;
  const glideHue = sectionHueSwatch(activeOverflow?.id ?? currentSectionId, scheme).tile;

  const renderTab = (section: Section) => {
    const active = section.id === currentSectionId;
    const Icon = sectionIcons[section.iconId];
    const showBadge = overdueCount > 0 && section.navItems.some((item) => item.badge === 'overdueTasks');
    return (
      <Pressable
        key={section.id}
        // Switch on finger-down, like iOS's native tab bar: the bar isn't
        // inside a scroller, so there's no drag a press-in could misread.
        // onPress stays for screen readers, whose activation fires onPress
        // without a press-in; after a real touch it's skipped so the same
        // tap doesn't navigate twice.
        onPressIn={() => {
          pressedInAt.current = Date.now();
          goTo(section);
        }}
        onPress={() => {
          if (Date.now() - pressedInAt.current < PRESS_IN_HANDLED_MS) return;
          goTo(section);
        }}
        // Hold to choose what sits in this slot (the press-in above has
        // already switched to the tab, so the sheet opens over it).
        onLongPress={() => {
          haptics.commit();
          setSlotPick(section);
        }}
        delayLongPress={SLOT_PICK_HOLD_MS}
        accessibilityActions={[{ name: 'longpress', label: 'Choose tab' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'longpress') setSlotPick(section);
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={showBadge ? `${section.label}, ${overdueCount} overdue` : section.label}
        onLayout={(e) => recordSlot(`tab:${section.id}`, e.nativeEvent.layout)}
        className="min-w-[44px] items-center gap-0.5 pb-2 pt-1.5 active:scale-[0.94]"
      >
        <TabFace
          Icon={Icon}
          label={section.shortLabel}
          active={active}
          hue={sectionHueSwatch(section.id, scheme)}
          badge={showBadge ? overdueCount : null}
        />
      </Pressable>
    );
  };

  return (
    <>
      <View
        className="relative z-30 shrink-0 flex-row items-stretch border-t border-border/60 bg-background/95"
        style={{ paddingBottom: insets.bottom }}
      >
        <TabGlide target={glideTarget} color={glideHue} />
        <View
          className="flex-1 flex-row justify-around"
          onLayout={(e) => recordSlot('group:left', e.nativeEvent.layout)}
        >
          {leftTabs.map(renderTab)}
        </View>
        <View className="relative w-16 shrink-0">
          <CaptureFab
            onPress={() => { haptics.commit(); openCapture(); }}
            onAsk={canAsk ? () => openRoute('/assistant/new?kind=quick') : undefined}
            unread={canAsk && assistantUnread > 0}
          />
          {/* HOUP-171: the dock's meridian tick — anchored near the bottom of
              this column, clear of the FAB's raised footprint. */}
          <MeridianAxis variant="dock" />
        </View>
        <View
          className="flex-1 flex-row justify-around"
          onLayout={(e) => recordSlot('group:right', e.nativeEvent.layout)}
        >
          {rightPrimary.map(renderTab)}
          {showMoreTab && (
            <Pressable
              onPress={() => setMoreOpen(true)}
              accessibilityRole="tab"
              accessibilityState={{ selected: moreActive }}
              accessibilityLabel={activeOverflow ? `More, ${activeOverflow.label}` : 'More'}
              onLayout={(e) => recordSlot('tab:more', e.nativeEvent.layout)}
              className="min-w-[44px] items-center gap-0.5 pb-2 pt-1.5 active:scale-[0.94]"
            >
              <TabFace
                Icon={MoreHorizontal}
                label="More"
                active={moreActive}
                hue={activeOverflow ? sectionHueSwatch(activeOverflow.id, scheme) : undefined}
                badge={moreHasOverdueBadge ? overdueCount : null}
              />
            </Pressable>
          )}
        </View>
      </View>

      {showMoreTab && (
        <SectionSwitcherSheet
          open={moreOpen}
          onOpenChange={setMoreOpen}
          sections={enabledSections}
          barSectionIds={barSectionIds}
          recentSections={recentSections}
          currentSectionId={currentSectionId}
          onSelect={(section) => {
            setMoreOpen(false);
            goTo(section);
          }}
          currentSectionLabel={currentSection.label}
          currentSectionNavItems={currentSection.navItems}
          overdueCount={overdueCount}
          onSelectNavItem={(href) => {
            setMoreOpen(false);
            // Same as `goTo` above: section roots switch in place, anything
            // else (e.g. /apartment/new) is pushed as a drill-in.
            openRoute(href);
          }}
        />
      )}

      <TabSlotPickerSheet
        slot={slotPick}
        onClose={() => setSlotPick(null)}
        sections={orderedSections}
        barSectionIds={barSectionIds}
        hiddenSectionIds={new Set(hiddenSections)}
        onChoose={(chosen) => slotPick && chooseForSlot(slotPick, chosen)}
      />
    </>
  );
}
