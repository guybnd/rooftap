// Hearth v2 (heading menu): the feed's title line, native twin of the
// FeedHeading in apps/web/src/app/home/today-hero.tsx. The title is the
// range picker ("Upcoming 7", opening a sheet of ranges with their counts)
// and the type and "just me" filters sit behind one filter button that
// wears a coral dot while any is on.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Check, ChevronDown, SlidersHorizontal, type LucideIcon } from 'lucide-react-native';
import {
  BottomSheet,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemTitle,
  ListItemTrailing,
  Text,
  haptics,
} from '@homeup/ui';
import { HERO_RANGES, HERO_RANGE_LABEL, type HeroRange, type HeroTypeFilter } from '@homeup/core';

export function FeedHeading({ title, trailing }: { title: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <View className="min-h-[44px] flex-row items-center justify-between gap-3 px-1">
      <View className="min-w-0 shrink flex-row items-center">{title}</View>
      {trailing}
    </View>
  );
}

export function FeedHeadingTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text numberOfLines={1} accessibilityRole="header" className="min-w-0 shrink font-heading text-[22px] font-semibold leading-7 text-foreground">
      {children}
    </Text>
  );
}

export interface FeedTypeOption {
  value: HeroTypeFilter;
  label: string;
  Icon: LucideIcon;
}

const tabular = { fontVariant: ['tabular-nums' as const] };

function SheetLabel({ children }: { children: string }) {
  return <Text className="px-4 pb-1.5 pt-1 text-micro-label uppercase text-muted-foreground">{children}</Text>;
}

function ChoiceRow({
  label,
  selected,
  onPress,
  leading,
  trailing,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <ListItem onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} className="items-center">
      {leading && <ListItemLeading className="mt-0">{leading}</ListItemLeading>}
      <ListItemContent>
        <ListItemTitle className={selected ? 'text-primary' : undefined}>{label}</ListItemTitle>
      </ListItemContent>
      <ListItemTrailing>
        {trailing}
        {selected ? <Check size={16} className="text-primary" /> : <View className="w-4" />}
      </ListItemTrailing>
    </ListItem>
  );
}

export function FeedControls({
  range,
  onRangeChange,
  count,
  rangeCounts,
  typeOptions,
  type,
  onTypeChange,
  mineOnly,
  onMineChange,
  filtered,
}: {
  range: HeroRange;
  onRangeChange: (range: HeroRange) => void;
  /** Open items in the visible feed. */
  count: number;
  rangeCounts: Record<HeroRange, number>;
  typeOptions: FeedTypeOption[];
  type: HeroTypeFilter;
  onTypeChange: (type: HeroTypeFilter) => void;
  mineOnly: boolean;
  onMineChange: (mineOnly: boolean) => void;
  filtered: boolean;
}) {
  const [rangeOpen, setRangeOpen] = React.useState(false);
  const [filterOpen, setFilterOpen] = React.useState(false);

  return (
    <>
      <FeedHeading
        title={
          <Pressable
            onPress={() => {
              haptics.select();
              setRangeOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${HERO_RANGE_LABEL[range]}, ${count} to do. Change range`}
            hitSlop={6}
            className="min-h-[44px] min-w-0 shrink flex-row items-center gap-2 active:opacity-70"
          >
            <FeedHeadingTitle>{HERO_RANGE_LABEL[range]}</FeedHeadingTitle>
            <Text className="font-mono text-body text-muted-foreground" style={tabular}>
              {count}
            </Text>
            <ChevronDown size={16} className="text-muted-foreground" />
          </Pressable>
        }
        trailing={
          <Pressable
            onPress={() => {
              haptics.select();
              setFilterOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={filtered ? 'Filters, on' : 'Filters'}
            className="h-11 w-11 items-center justify-center rounded-full bg-card/70 active:bg-card"
          >
            <SlidersHorizontal size={16} className="text-muted-foreground" />
            {filtered && <View className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full border-2 border-background bg-primary" />}
          </Pressable>
        }
      />

      <BottomSheet open={rangeOpen} onOpenChange={setRangeOpen} className="pb-4">
        <SheetLabel>Show</SheetLabel>
        <ListGroup className="mx-3 border-0 bg-transparent">
          {HERO_RANGES.map((r) => (
            <ChoiceRow
              key={r}
              label={HERO_RANGE_LABEL[r]}
              selected={r === range}
              onPress={() => {
                onRangeChange(r);
                setRangeOpen(false);
              }}
              trailing={
                <Text className={`font-mono text-caption ${r === range ? 'text-primary' : 'text-muted-foreground'}`} style={tabular}>
                  {rangeCounts[r]}
                </Text>
              }
            />
          ))}
        </ListGroup>
      </BottomSheet>

      <BottomSheet open={filterOpen} onOpenChange={setFilterOpen} className="pb-4">
        {typeOptions.length > 1 && (
          <>
            <SheetLabel>Type</SheetLabel>
            <ListGroup className="mx-3 border-0 bg-transparent">
              {typeOptions.map((o) => (
                <ChoiceRow
                  key={o.value}
                  label={o.label}
                  selected={o.value === type}
                  leading={<o.Icon size={18} className="text-muted-foreground" />}
                  onPress={() => {
                    onTypeChange(o.value);
                    setFilterOpen(false);
                  }}
                />
              ))}
            </ListGroup>
          </>
        )}
        <SheetLabel>People</SheetLabel>
        <ListGroup className="mx-3 border-0 bg-transparent">
          <ChoiceRow
            label="Just me"
            selected={mineOnly}
            onPress={() => {
              onMineChange(!mineOnly);
              setFilterOpen(false);
            }}
          />
        </ListGroup>
      </BottomSheet>
    </>
  );
}
