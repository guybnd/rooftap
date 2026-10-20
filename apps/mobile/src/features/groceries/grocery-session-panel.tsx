// HOUP-80/HOUP-226: today's shop, native twin of
// apps/web/src/app/groceries/grocery-session-panel.tsx.
//
// The whole trip lives in floating layers above the tab bar, never in the
// list: TrackShopPrompt asks (accent, #393), then once tracking is on
// ShopTrackingPill holds the running total (tap to override), Receipt and
// Done, however far the list scrolls. Done opens FinishShopSheet: scan the
// receipt and finish in one move (reads the total, learns prices), or a
// photo, or no receipt (Guy, 2026-10-20). Once skipped, the way back is
// "Track shop" in the header's More menu and the This trip summary.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { Camera, Check, Loader2, Receipt } from 'lucide-react-native';
import { BottomSheet, Text, Button, Input, cn, haptics } from '@homeup/ui';
import { effectiveSessionTotal, formatMoney, MOTION_DURATIONS_MS, useModules, type GrocerySession } from '@homeup/core';

/** Where the trip's total came from, for its caption. */
function totalSource(session: GrocerySession): string {
  return session.override_total_cents != null ? 'manual total' : session.receipt_total_cents != null ? 'from receipt' : 'estimated';
}

/** The trip's total; tapping it swaps in an input to override it (empty clears
 *  the override). H1: never display weight in the pill (the screen's lede is
 *  the only Hero); T3: money stays out of mono, tabular figures align it. */
function EditableTotal({
  session,
  caption,
  onOverrideTotal,
  size = 'body',
}: {
  session: GrocerySession;
  caption: string;
  onOverrideTotal: (cents: number | null) => void;
  size?: 'body' | 'display';
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const total = effectiveSessionTotal(session);

  const commit = () => {
    const parsed = parseFloat(draft);
    onOverrideTotal(draft.trim() === '' || Number.isNaN(parsed) ? null : Math.round(parsed * 100));
    setEditing(false);
  };

  if (editing) {
    return (
      <View className="min-w-0 flex-1 flex-row items-center gap-2">
        <Input
          autoFocus
          keyboardType="decimal-pad"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={commit}
          onBlur={commit}
          className="flex-1"
          placeholder="0.00"
          accessibilityLabel="Trip total"
        />
        <Button size="icon-sm" variant="outline" onPress={commit} accessibilityLabel="Save total">
          <Check size={16} className="text-primary" />
        </Button>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => {
        setDraft(String(total / 100));
        setEditing(true);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${formatMoney(total)}, ${caption}. Change total`}
      className={cn('min-h-11 min-w-0 flex-1 justify-center', size === 'display' && 'gap-0.5')}
    >
      <Text
        numberOfLines={1}
        className={size === 'display' ? 'text-display text-foreground' : 'text-sm font-semibold text-foreground'}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {formatMoney(total)}
      </Text>
      <Text numberOfLines={1} className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
        {caption}
      </Text>
    </Pressable>
  );
}

interface ShopTrackingPillProps {
  session: GrocerySession;
  boughtCount: number;
  /** Distance from the screen's bottom edge (same spot as TrackShopPrompt). */
  bottom: number;
  onOverrideTotal: (cents: number | null) => void;
  onReceipt: () => void;
  receiptBusy: boolean;
  receiptError: string | null;
  onDone: () => void;
  /** Tracking was just tapped and today's session is still being saved: the
   *  pill shows straight away, with Receipt and Done waiting for the save. */
  pending?: boolean;
}

/** While a shop is tracked: a floating pill in the Track ask's spot, so the
 *  total, the receipt and Done stay under the thumb however far the list
 *  scrolls (Guy, 2026-10-20). A neutral popover, not the ask's accent: it's a
 *  standing tool, not a question. Done opens FinishShopSheet. */
export function ShopTrackingPill({ session, boughtCount, bottom, onOverrideTotal, onReceipt, receiptBusy, receiptError, onDone, pending = false }: ShopTrackingPillProps) {
  const source = totalSource(session);
  const caption = `${source === 'estimated' ? 'in cart' : source} · ${boughtCount} got`;
  return (
    <Animated.View
      entering={FadeInDown.duration(MOTION_DURATIONS_MS.base)}
      exiting={FadeOutDown.duration(MOTION_DURATIONS_MS.fast)}
      pointerEvents="box-none"
      className="absolute inset-x-4 z-40 items-center"
      style={{ bottom }}
    >
      <View className="w-full max-w-md gap-1 rounded-2xl border border-border bg-popover py-2 pl-4 pr-2 shadow-lg">
        <View className="flex-row items-center gap-2">
          <EditableTotal session={session} caption={caption} onOverrideTotal={onOverrideTotal} />
          <Button size="sm" variant="outline" onPress={onReceipt} disabled={receiptBusy || pending} accessibilityLabel={session.receipt_path ? 'Replace receipt' : 'Add receipt'}>
            {receiptBusy ? <Loader2 size={14} className="animate-spin text-foreground" /> : <Camera size={14} className="text-foreground" />}
            <Text className="text-sm font-medium text-foreground">Receipt</Text>
          </Button>
          <Pressable
            onPress={() => {
              haptics.select();
              onDone();
            }}
            disabled={pending}
            accessibilityRole="button"
            className={cn('min-h-11 shrink-0 justify-center rounded-xl bg-foreground px-4 active:opacity-80', pending && 'opacity-60')}
          >
            <Text className="text-sm font-semibold text-background">Done</Text>
          </Pressable>
        </View>
        {receiptError ? (
          <Pressable onPress={onReceipt} accessibilityRole="button" className="pb-1">
            <Text className="text-caption text-destructive" numberOfLines={1}>
              {receiptError}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

export type FinishReceiptSource = 'camera' | 'library' | null;

interface FinishShopSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: GrocerySession | null;
  boughtCount: number;
  unpricedCount: number;
  onOverrideTotal: (cents: number | null) => void;
  /** Reads the receipt (when a source is given) and finishes the trip. */
  onFinish: (source: FinishReceiptSource) => void;
  onStopTracking: () => void;
  busy: boolean;
  error: string | null;
}

/** Done's sheet: the trip's total (tap to override), then one move to scan the
 *  receipt and finish, with a photo or no receipt as the quieter choices. The
 *  sheet is its own layer, so its primary takes the accent (H5). */
export function FinishShopSheet({
  open,
  onOpenChange,
  session,
  boughtCount,
  unpricedCount,
  onOverrideTotal,
  onFinish,
  onStopTracking,
  busy,
  error,
}: FinishShopSheetProps) {
  const modules = useModules();
  const toCosts = modules.feature('costs.from-groceries');
  const caption = session
    ? [totalSource(session), `${boughtCount} got`, unpricedCount > 0 ? `${unpricedCount} unpriced` : null].filter(Boolean).join(' · ')
    : '';
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      {session && (
        <View className="gap-4 px-5 pb-6 pt-1">
          <View className="gap-1">
            <Text className="text-title text-foreground">Finish today's shop</Text>
            <EditableTotal session={session} caption={caption} onOverrideTotal={onOverrideTotal} size="display" />
          </View>
          <Pressable
            onPress={() => {
              haptics.commit();
              onFinish('camera');
            }}
            disabled={busy}
            accessibilityRole="button"
            className={cn('min-h-14 flex-row items-center gap-3 rounded-2xl bg-primary px-4 active:opacity-80', busy && 'opacity-60')}
          >
            {busy ? <Loader2 size={20} className="animate-spin text-primary-foreground" /> : <Camera size={20} className="text-primary-foreground" />}
            <View className="flex-1">
              <Text className="text-[15px] font-semibold text-primary-foreground">{busy ? 'Reading receipt…' : 'Scan receipt and finish'}</Text>
              <Text className="text-caption text-primary-foreground/80">Reads the real total and learns prices</Text>
            </View>
          </Pressable>
          <View className="flex-row gap-2">
            <Button size="sm" variant="outline" className="h-12 flex-1" disabled={busy} onPress={() => onFinish('library')}>
              Pick a photo
            </Button>
            <Button size="sm" variant="outline" className="h-12 flex-1" disabled={busy} onPress={() => onFinish(null)}>
              Finish without
            </Button>
          </View>
          {error ? <Text className="text-center text-caption text-destructive">{error}</Text> : null}
          <View className="flex-row items-center justify-between">
            <Text className="text-caption text-muted-foreground">{toCosts ? 'The trip adds to Costs either way' : 'Bought items move to Have it'}</Text>
            <Button size="sm" variant="ghost" disabled={busy} onPress={onStopTracking}>
              Stop tracking
            </Button>
          </View>
        </View>
      )}
    </BottomSheet>
  );
}

interface TrackShopPromptProps {
  boughtCount: number;
  summedCents: number;
  /** Distance from the screen's bottom edge (clears the capture button's lip). */
  bottom: number;
  onStartTracking: () => void;
  onSkipTracking: () => void;
}

/** Floating accent popup that asks to track today's shop once something is in
 *  the cart and no decision has been made yet. Rendered by the screen as an
 *  overlay, so it never moves the list. Both buttons answer at once: the
 *  screen hides the ask (and shows the pill for Track) before the session is
 *  saved, never after the round trip. */
export function TrackShopPrompt({ boughtCount, summedCents, bottom, onStartTracking, onSkipTracking }: TrackShopPromptProps) {
  const modules = useModules();
  // Modules: the trip only lands in Costs when costs and groceries are both on (module-features.ts).
  const toCosts = modules.feature('costs.from-groceries');

  return (
    <Animated.View
      entering={FadeInDown.duration(MOTION_DURATIONS_MS.base)}
      exiting={FadeOutDown.duration(MOTION_DURATIONS_MS.fast)}
      pointerEvents="box-none"
      className="absolute inset-x-4 z-40 items-center"
      style={{ bottom }}
    >
      <View
        accessibilityRole="alert"
        className="w-full max-w-md flex-row items-center gap-3 rounded-2xl bg-primary py-2.5 pl-4 pr-2 shadow-lg"
      >
        <Receipt size={18} className="shrink-0 text-primary-foreground" />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-sm font-semibold text-primary-foreground">
            Track today's shop?
          </Text>
          <Text numberOfLines={1} className="text-caption text-primary-foreground/80" style={{ fontVariant: ['tabular-nums'] }}>
            {boughtCount} in cart · ~{formatMoney(summedCents)}
            {toCosts ? ' · adds to Costs' : ''}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            haptics.select();
            onSkipTracking();
          }}
          hitSlop={4}
          accessibilityRole="button"
          className="min-h-11 shrink-0 justify-center rounded-xl px-2.5 active:opacity-60"
        >
          <Text className="text-sm text-primary-foreground/80">Not today</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            haptics.commit();
            onStartTracking();
          }}
          hitSlop={4}
          accessibilityRole="button"
          className="min-h-11 shrink-0 justify-center rounded-xl bg-primary-foreground px-4 active:opacity-80"
        >
          <Text className="text-sm font-semibold text-primary">Track</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}
