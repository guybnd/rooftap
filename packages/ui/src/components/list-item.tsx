// HOUP-68: native port of apps/web/src/components/ui/list-item.tsx.
//
// Two web mechanisms have no 1:1 RN equivalent (flagged in the approved
// plan review) and are re-expressed rather than blindly ported:
//  - `divide-y divide-border` (ListGroup): RN has no sibling-selector
//    dividers — ListGroup now inserts an explicit 1px divider View between
//    children instead.
//  - the `grid-rows-[0fr]->[1fr]` collapse animation (ListItemBody): RN has
//    no CSS grid/auto-height transitions — ListItemBody uses Reanimated's
//    enter/exit transitions on a plain conditional render instead of
//    interpolating a measured height.
//
// The web `asChild`/Slot polymorphism (render as Link vs. div) is dropped —
// RN's Pressable already behaves like a plain View with no handlers attached,
// so ListItem is always a Pressable; consumers pass `onPress` (or omit it).
import * as React from 'react';
import { Pressable, Text, View, type PressableProps, type TextProps, type ViewProps } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { flattenMetaChildren } from '../lib/flatten-meta-children';
import { shouldWrapTitleChildren } from '../lib/list-item-title';
import { HoldFillOverlay } from '../primitives/hold-fill-overlay';
import { useThemeMaterial } from '../theme/theme-provider';
import { Pill } from './pill';
import { ArriveView } from './arrive';

// H4: the outer `ListGroup` owns the single border level per view; rows
// inside it are never individually bordered cards.
// M2: 55px row floor (settings rows measure ~54dp on device).
// `items-start` (not `-center`) so the leading slot aligns to the title's
// cap-height instead of centering against the full title+meta stack.
const listItemVariants = cva('relative w-full min-h-[55px] flex-row items-start gap-3 p-3');

export interface ListItemProps extends Omit<PressableProps, 'children'> {
  /** Whether the optional `ListItemBody` beneath this row is open. */
  expanded?: boolean;
  /** FLUX-198 parity: opt-in hold-to-edit fill (0->1). Renders `<HoldFillOverlay>` behind the row's content. Omit for no behavior/visual change. */
  holdProgress?: number;
  children?: React.ReactNode;
}

function ListItem({ expanded = false, holdProgress, className, children, ...props }: ListItemProps) {
  return (
    <Pressable
      // `active:` (NativeWind's press-state variant, same mechanism Button
      // uses for `active:bg-primary/80`) gives touch-down the same
      // `bg-accent/30` feedback `expanded` already uses statically - a plain
      // className with no press variant gave native rows zero touch-down
      // feedback (reads as lag). PressableProps.className is typed as a
      // plain string (inherited from ViewProps), not the `{pressed}` render
      // prop `style` supports, so the variant has to live in the class list.
      className={cn(listItemVariants(), 'active:bg-accent/30', expanded && 'bg-accent/30', className)}
      {...props}
    >
      {holdProgress !== undefined && <HoldFillOverlay progress={holdProgress} />}
      {children}
    </Pressable>
  );
}

export interface ListGroupProps extends ViewProps {
  /**
   * Default `true`: the single-bordered-card treatment. Pass `false` for an
   * inset region already inside another card (HOUP-332's inline checklist
   * panel) — no border, no shadow, no card-in-card, hairline dividers only.
   */
  bordered?: boolean;
}

/**
 * H4 list container: single border + shadow for the whole list, with hairline
 * dividers between `ListItem` rows. Wrap every list of `ListItem` rows in
 * this instead of a bare gapped column.
 *
 * HOUP-132: the group's shadow is the theme's `--card-shadow` — the same
 * elevation token `Card` uses, since ListGroup is the "single bordered
 * surface" the design language treats interchangeably with a card (H4).
 */
function ListGroup({ className, style, children, bordered = true, ...props }: ListGroupProps) {
  const items = React.Children.toArray(children);
  const material = useThemeMaterial();
  return (
    <ArriveView
      className={cn(bordered && 'overflow-hidden rounded-3xl border border-border/60 bg-card', className)}
      style={bordered ? [{ boxShadow: material.cardShadow }, style] : style}
      {...props}
    >
      {items.map((child, index) => (
        <React.Fragment key={index}>
          {index > 0 && <View className="h-px bg-border" />}
          {child}
        </React.Fragment>
      ))}
    </ArriveView>
  );
}

function ListItemLeading({ className, ...props }: ViewProps) {
  // `mt-0.5` compensates for the row's `items-start` (was `items-center`):
  // it nudges the leading chip/checkbox down to the title's cap-height
  // instead of leaving it pinned to the row's very top edge.
  return <View className={cn('relative mt-0.5 shrink-0 flex-row items-center justify-center', className)} {...props} />;
}

function ListItemContent({ className, ...props }: ViewProps) {
  return <View className={cn('relative min-w-0 flex-1 flex-col gap-0.5', className)} {...props} />;
}

function ListItemTitle({ className, children, ...props }: TextProps & { children?: React.ReactNode }) {
  return (
    <View className="min-w-0 flex-row items-center gap-1.5">
      {shouldWrapTitleChildren(children) ? (
        <Text numberOfLines={1} className={cn('font-medium text-foreground', className)} {...props}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

function isChipChild(node: React.ReactNode): boolean {
  return React.isValidElement(node) && node.type === Pill;
}

function ListItemMeta({ className, children, ...props }: ViewProps) {
  // Bakes a ' · ' separator between meta children instead of relying on a
  // bare flex-wrap gap - two adjacent captions ("1d overdue" "Med") used to
  // read as a single run with a stray gap instead of grammatical meta text
  // ("status · type · data fragments" per Hearth's meta grammar). Skipped
  // next to a `Pill` child - chip rows (e.g. shelf-life's Custom/Hidden
  // pills, recipe cuisine tags) already carry their own visual boundary and
  // a dot between two pills reads as noise, not grammar.
  //
  // HOUP-305: top-level fragments are flattened first — toArray treats a
  // `<>a b c</>` child as ONE item, which put every fragment of HeroTaskRow's
  // meta into a single column-direction wrapper View (fragments stacked
  // vertically, no dots).
  const items = flattenMetaChildren(children);
  return (
    // HOUP-253: `min-w-0` here too - without it, this nested flex-wrap row's
    // intrinsic content width can still push `ListItemContent` wider than
    // available space even though Content itself has `min-w-0 flex-1`.
    <View className={cn('min-w-0 flex-row flex-wrap items-center gap-1.5', className)} {...props}>
      {items.map((child, index) => {
        const isChip = isChipChild(child);
        const needsDot = index > 0 && !isChip && !isChipChild(items[index - 1]);
        return (
          <React.Fragment key={index}>
            {needsDot && <Text className="text-caption text-muted-foreground">·</Text>}
            {/* HOUP-253: non-chip children get a shrinkable min-w-0 wrapper
                so a long unbroken caption wraps within the row instead of
                forcing row width (RN Views/Text default to flexShrink 0).
                Pills are left bare - they're fixed-size by design. */}
            {isChip ? child : <View className="min-w-0 shrink">{child}</View>}
          </React.Fragment>
        );
      })}
    </View>
  );
}

function ListItemTrailing({ className, ...props }: ViewProps) {
  // See ListItemLeading's `mt-0.5` note - same cap-height compensation for
  // the row's `items-start` alignment.
  return <View className={cn('relative mt-0.5 shrink-0 flex-row items-center gap-1', className)} {...props} />;
}

export interface ListItemBodyProps extends ViewProps {
  /** Controls the collapse/expand transition independent of the root's `expanded` (kept in sync by the consumer). */
  expanded?: boolean;
}

function ListItemBody({ expanded = false, className, children, ...props }: ListItemBodyProps) {
  if (!expanded) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      className={cn('bg-muted/20 px-3 pb-3', className)}
      {...props}
    >
      {children}
    </Animated.View>
  );
}

export {
  ListItem,
  ListGroup,
  ListItemLeading,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
  ListItemBody,
  listItemVariants,
};
