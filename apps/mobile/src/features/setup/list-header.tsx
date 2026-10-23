import { Pressable, View } from 'react-native';
import { ChevronDown, Plus, RotateCw, Sparkles, Store as StoreIcon } from 'lucide-react-native';
import { Text, Button, Card, HeroLede, LeadingTile, PulseTile, SectionSearchBar, SegmentedControl, cn } from '@homeup/ui';
import { SETUP_STATUS_SEGMENTS, setupHeroCaption, type SetupItem, type SetupStore, type SetupSummary, type SetupStatusSegment, currencySymbol } from '@homeup/core';
import { BudgetSummary } from '@/features/setup/budget-summary';
import { SegmentedBar } from '@/features/setup/segmented-bar';

export const money = (n: number) => `${currencySymbol()}${n.toLocaleString()}`;

// Filter chips: neutral at rest, the interactive accent when on (H2).
export const chipClass = (active: boolean) =>
  cn('min-h-9 flex-row items-center justify-center gap-1 rounded-full border px-3', active ? 'border-primary/40 bg-primary/15' : 'border-border bg-transparent');

export const chipTextClass = (active: boolean) => cn('text-xs font-medium', active ? 'text-primary' : 'text-muted-foreground');

export interface SetupListHeaderProps {
  allItemsCount: number;
  reorderMode: boolean;
  onExitReorderMode: () => void;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  onRefresh: () => void;
  onAddItem: () => void;
  overall: SetupSummary;
  doneCount: number;
  topRoomSummaries: ({ room: string } & SetupSummary)[];
  notice: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  statusSegment: SetupStatusSegment;
  onStatusSegmentChange: (segment: SetupStatusSegment) => void;
  mineOnly: boolean;
  onToggleMineOnly: () => void;
  existingRooms: string[];
  roomFilter: string | null;
  onOpenRoomPicker: () => void;
  stores: SetupStore[];
  storeFilter: string | null;
  onOpenStorePicker: () => void;
  storeTrip: (SetupSummary & { storeName: string }) | null;
  isSeeding: boolean;
  onSeedTemplates: () => void;
}

/** HOUP-207: the setup lede, top controls, notices, and filters — hoisted into
 * `FlashList`'s `ListHeaderComponent` (and reused verbatim atop the reorder-mode
 * `ScrollView`) so it scrolls with content in both modes. Passed as a memoized
 * element (never an inline closure) so the search bar never remounts mid-type. */
export function SetupListHeader({
  allItemsCount,
  reorderMode,
  onExitReorderMode,
  selectMode,
  onToggleSelectMode,
  onRefresh,
  onAddItem,
  overall,
  doneCount,
  topRoomSummaries,
  notice,
  search,
  onSearchChange,
  statusSegment,
  onStatusSegmentChange,
  mineOnly,
  onToggleMineOnly,
  existingRooms,
  roomFilter,
  onOpenRoomPicker,
  stores,
  storeFilter,
  onOpenStorePicker,
  storeTrip,
  isSeeding,
  onSeedTemplates,
}: SetupListHeaderProps) {
  return (
    <View className="gap-4 pb-4">
      {/* H1: one lede. Hearth v2 (Pulse): what's still to get is a Hero
          number, with its own meter once something is done (H3); the
          actions sit on the label row above it. Mirrors web page.tsx. */}
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-micro-label uppercase text-muted-foreground">Setup</Text>
        <View className="flex-row items-center gap-2">
          {/* H5: "Add" is the screen's one filled action; an active toggle
              takes the accent tint, not a second fill (mirrors web). The count
              lives in the select bar below. */}
          {allItemsCount > 0 && !reorderMode && (
            <Button
              size="sm"
              variant="outline"
              onPress={onToggleSelectMode}
              accessibilityState={{ selected: selectMode }}
              className={cn(selectMode && 'border-primary/40 bg-primary/15')}
              textClassName={cn(selectMode && 'text-primary')}
            >
              {selectMode ? 'Done' : 'Select'}
            </Button>
          )}
          {/* HOUP-174: Reorder is no longer a persistent header peer of Select —
              it now only surfaces inside the Select-mode action bar below.
              This button just gives reorder mode an exit affordance. */}
          {reorderMode && (
            <Button size="sm" variant="outline" onPress={onExitReorderMode} className="border-primary/40 bg-primary/15" textClassName="text-primary">
              Done
            </Button>
          )}
          <Button size="icon-sm" variant="outline" onPress={onRefresh} accessibilityLabel="Refresh">
            <RotateCw size={14} className="text-foreground" />
          </Button>
          <Button size="sm" onPress={onAddItem}>
            <Plus size={14} className="text-primary-foreground" />
            <Text className="text-sm font-medium text-primary-foreground">Add</Text>
          </Button>
        </View>
      </View>
      <HeroLede
        value={overall.outstanding}
        label="to get"
        meter={doneCount > 0 ? { done: doneCount, total: overall.total } : undefined}
        caption={setupHeroCaption(overall, money)}
      />

      {/* Pulse strip: with a single room its tile would restate the Hero
          number (H1), so room tiles show only once there are two or more. */}
      {overall.total > 0 && (
        <View className="flex-row gap-2">
          {topRoomSummaries.length > 1 &&
            topRoomSummaries.map((r) => (
              <PulseTile
                key={r.room}
                label={r.room}
                value={r.outstanding > 0 ? `${r.outstanding} left` : 'Done'}
                meter={{ value: r.total - r.outstanding, total: r.total }}
                tone={r.outstanding === 0 ? 'success' : 'neutral'}
                className="flex-1"
              />
            ))}
          <PulseTile
            label="Budget left"
            value={money(Math.max(0, overall.est - overall.spent))}
            meter={{ value: overall.spent, total: overall.est }}
            tone={overall.spent > overall.est ? 'danger' : 'neutral'}
            className="flex-1"
          />
        </View>
      )}

      {notice && (
        <Card className="rounded-3xl px-4 py-3">
          <Text className="text-body text-foreground">{notice}</Text>
        </Card>
      )}

      {reorderMode && (
        <Card className="rounded-3xl px-4 py-3">
          <Text className="text-body text-muted-foreground">Drag the handle to reorder items within a room</Text>
        </Card>
      )}

      {allItemsCount > 0 && !reorderMode && (
        <View className="gap-3">
          <SectionSearchBar value={search} onChange={onSearchChange} placeholder="Search items…" />

          {/* H2: still to buy is not a danger state, so status filters by a
              neutral segmented track instead of red/green chips (mirrors web). */}
          <View className="flex-row items-center gap-2">
            <SegmentedControl
              options={SETUP_STATUS_SEGMENTS}
              value={statusSegment}
              onChange={onStatusSegmentChange}
              size="sm"
              accessibilityLabel="Filter by status"
              className="min-h-11 flex-1"
            />
            <Pressable
              onPress={onToggleMineOnly}
              accessibilityRole="button"
              accessibilityState={{ selected: mineOnly }}
              className={cn(chipClass(mineOnly), 'min-h-11 rounded-lg')}
            >
              <Text className={chipTextClass(mineOnly)}>Mine only</Text>
            </Pressable>
          </View>

          {(existingRooms.length > 0 || stores.length > 0) && (
            <View className="flex-row flex-wrap items-center gap-2">
              {/* HOUP-174: chip walls replaced with a single trigger chip each,
                  opening a BottomSheet picker (H5 — the control lives with the
                  surface it filters, without flooding the row with one chip
                  per room/store). */}
              {existingRooms.length > 0 && (
                <Pressable onPress={onOpenRoomPicker} hitSlop={4} accessibilityRole="button" className={chipClass(!!roomFilter)}>
                  <Text className={chipTextClass(!!roomFilter)}>{roomFilter ?? 'All rooms'}</Text>
                  <ChevronDown size={12} className={roomFilter ? 'text-primary' : 'text-muted-foreground'} />
                </Pressable>
              )}
              {stores.length > 0 && (
                <Pressable onPress={onOpenStorePicker} hitSlop={4} accessibilityRole="button" className={chipClass(!!storeFilter)}>
                  <Text className={chipTextClass(!!storeFilter)}>
                    {stores.find((s) => s.id === storeFilter)?.name ?? 'All stores'}
                  </Text>
                  <ChevronDown size={12} className={storeFilter ? 'text-primary' : 'text-muted-foreground'} />
                </Pressable>
              )}
            </View>
          )}
        </View>
      )}

      {/* HOUP-174: shopping-trip rollup for the active store filter — ports
          web page.tsx:515-534's store-trip summary card. Not gated on
          reorderMode — mirrors the original, which only hid the *picker*
          in reorder mode, not an already-active trip card. */}
      {storeTrip && (
        // H2: a neutral card with the Setup tile; coral is for controls.
        <Card className="gap-2.5 rounded-3xl px-4 py-3">
          <View className="flex-row items-center gap-3">
            <LeadingTile sectionId="setup" Icon={StoreIcon} size="md" />
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="text-sm font-semibold text-foreground">{storeTrip.storeName}</Text>
              <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {storeTrip.total - storeTrip.outstanding} of {storeTrip.total} bought
              </Text>
            </View>
            <Text className="shrink-0" style={{ fontVariant: ['tabular-nums'] }}>
              <Text className="text-sm font-semibold text-foreground">{money(storeTrip.est)}</Text>
              <Text className="text-xs text-muted-foreground"> est</Text>
            </Text>
          </View>
          <SegmentedBar counts={storeTrip.counts} />
        </Card>
      )}

      {allItemsCount === 0 && (
        <Card className="items-center gap-3 rounded-3xl px-4 py-10">
          <Text className="text-center text-body text-muted-foreground">No setup items yet. Add items room by room, or start from a ready-made list.</Text>
          <Button variant="outline" size="sm" onPress={onSeedTemplates} disabled={isSeeding}>
            <Sparkles size={14} className="text-foreground" />
            <Text className="text-sm text-foreground">{isSeeding ? 'Adding…' : 'Add starter items'}</Text>
          </Button>
        </Card>
      )}
    </View>
  );
}

export interface SetupBudgetFooterProps {
  allItemsCount: number;
  allSetupItems: SetupItem[];
}

export function SetupBudgetFooter({ allItemsCount, allSetupItems }: SetupBudgetFooterProps) {
  if (allItemsCount === 0) return null;
  return (
    <View className="mt-6 gap-2">
      <Text className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Budget</Text>
      <BudgetSummary items={allSetupItems} />
    </View>
  );
}
