// HOUP-91: native port of apps/web/src/components/ui/item-form-sheet.tsx —
// the shared shell every "add / edit an item" bottom sheet (recipe,
// grocery, cost, to-do, setup) is built on. Hearth M4 (sheet not modal),
// E1-E4 (header states item, property rows, inset groups, destructive
// alone).
//
// Web layers this on `@base-ui/react/dialog` + `useKeyboardInset`
// (`visualViewport`) for focus-trap/Escape/scroll-lock/keyboard offset —
// `BottomSheet` already owns focus/back-button/backdrop dismiss on native
// (RN `Modal`). Safe-area bottom inset is likewise already handled inside
// `BottomSheet`, not re-derived here.
//
// HOUP-244: `BottomSheet` itself now floats + shrinks above the keyboard
// (packages/ui/src/hooks/use-keyboard-offset.ts) — the iOS-only
// `KeyboardAvoidingView` this file used to wrap its content in is removed
// to avoid double-offsetting the same keyboard on top of that.
//
// The body ScrollView stays content-sized (a `maxHeight`, not `flex-1`),
// same as every other BottomSheet caller (capture-sheet, searchable-picker):
// BottomSheet's own Animated.View is `absolute bottom-0 max-h-[88%]`, i.e.
// auto-height capped by a maxHeight, not a definite-height flex column — a
// `flex-1` child of an auto-height parent has no main size to distribute
// against and Yoga collapses it to 0 (the pre-fix regression). Instead the
// cap here mirrors BottomSheet's own shrink math directly: a resting
// fraction of the window height (matching the pre-HOUP-244 fixed
// `max-h-[60vh]`), minus the same keyboard offset BottomSheet floats by.
import * as React from 'react';
import { Alert, Pressable, Text, useWindowDimensions, View } from 'react-native';
import type { ScrollView } from 'react-native';
import { X } from 'lucide-react-native';
import { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cn } from '../lib/cn';
import { commit, remove, warn } from '../lib/haptics';
import { useKeyboardOffset } from '../hooks/use-keyboard-offset';
import { Button } from './button';
import { BottomSheet } from './bottom-sheet';
import { BottomSheetScrollView } from './bottom-sheet-scroll-view';
import { LeadingTile, type LeadingTileIcon } from './leading-tile';

/** Body's resting cap — mirrors the pre-HOUP-244 fixed `max-h-[60vh]`. */
const BODY_REST_HEIGHT_FRACTION = 0.6;
/** Never shrink the scrollable body below a usable minimum as the keyboard grows. */
const BODY_MIN_HEIGHT = 160;

export interface ItemFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Small leading glyph/emoji shown before the title. */
  icon?: React.ReactNode;
  /**
   * Replaces the static icon+title header row with a richer live item
   * preview (e.g. emoji/name/status/price). `title` is still required for
   * accessibility even when this is provided.
   */
  previewContent?: React.ReactNode;
  /**
   * Hearth v2 (E1, Feed): the section the item belongs to. The header then
   * leads with that section's identity tile, the same one the item's row
   * wears in lists and the Home feed.
   */
  section?: { id: string; Icon: LeadingTileIcon };
  onSubmit: () => void;
  submitLabel?: string;
  /** Save is disabled until this is true (defaults to true). */
  canSubmit?: boolean;
  /** Disables the footer buttons + shows a saving label. */
  saving?: boolean;
  /**
   * When provided, a Delete button is rendered (edit mode). HOUP-191: the
   * footer always confirms before calling this — callers must not layer
   * their own confirmation on top (that would show two dialogs in a row).
   */
  onDelete?: () => void;
  deleteLabel?: string;
  /** Confirm dialog title override. Defaults to `${deleteLabel}?`. */
  deleteConfirmTitle?: string;
  /** Confirm dialog message override. Defaults to a generic "can't be undone" warning. */
  deleteConfirmMessage?: string;
  children: React.ReactNode;
}

/** Forwarded to the body ScrollView so a caller can scroll to a specific
 *  field/section (e.g. the recipe quick-editor's `focusMatch`). */
export const ItemFormSheet = React.forwardRef<ScrollView, ItemFormSheetProps>(function ItemFormSheet(
  {
    open,
    onOpenChange,
    title,
    icon,
    previewContent,
    section,
    onSubmit,
    submitLabel = 'Save',
    canSubmit = true,
    saving = false,
    onDelete,
    deleteLabel = 'Delete',
    deleteConfirmTitle,
    deleteConfirmMessage,
    children,
  },
  scrollRef
) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardOffset = useKeyboardOffset(insets.bottom);
  const bodyStyle = useAnimatedStyle(() => ({
    maxHeight: Math.max(BODY_MIN_HEIGHT, windowHeight * BODY_REST_HEIGHT_FRACTION - keyboardOffset.value),
  }));

  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const submit = React.useCallback(() => {
    if (!canSubmit || saving) return;
    // HA: submitting commits; a failed save answers with an error toast's error().
    commit();
    onSubmit();
  }, [canSubmit, saving, onSubmit]);
  // HOUP-191: destructive confirm lives here, once, instead of every caller
  // hand-rolling (or forgetting) its own Alert.alert before onDelete.
  const requestDelete = React.useCallback(() => {
    if (!onDelete) return;
    warn();
    Alert.alert(deleteConfirmTitle ?? `${deleteLabel}?`, deleteConfirmMessage ?? "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: deleteLabel,
        style: 'destructive',
        onPress: () => {
          remove();
          onDelete();
        },
      },
    ]);
  }, [onDelete, deleteLabel, deleteConfirmTitle, deleteConfirmMessage]);

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="max-h-[88%]">
      <View>
        {/* Header */}
        <View className={cn('flex-row items-center border-b border-border px-4 pb-3 pr-11', section ? 'gap-3' : 'gap-2')}>
          {section && <LeadingTile sectionId={section.id} Icon={section.Icon} />}
          {previewContent != null ? (
            <View className="min-w-0 flex-1 flex-row items-center gap-2">{previewContent}</View>
          ) : (
            <>
              {icon != null &&
                (typeof icon === 'string' ? (
                  <Text className="text-xl leading-none">{icon}</Text>
                ) : (
                  icon
                ))}
              <Text numberOfLines={1} className="min-w-0 flex-1 font-heading text-title font-semibold text-foreground">
                {title}
              </Text>
            </>
          )}
        </View>

        {/* Scrollable grouped body — content-sized, capped by bodyStyle's
            keyboard-aware maxHeight (see top-of-file note); BottomSheetScrollView
            (not a plain Animated.ScrollView) so it still participates in the
            sheet's at-top drag-dismiss gate (HOUP-247). */}
        <BottomSheetScrollView
          ref={scrollRef}
          style={bodyStyle}
          contentContainerClassName="gap-4 px-4 py-4"
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </BottomSheetScrollView>

        {/* Sticky footer */}
        <View className="flex-row items-center gap-2 border-t border-border bg-muted/40 px-4 py-3">
          {onDelete && (
            <Button variant="destructive" size="sm" onPress={requestDelete} disabled={saving}>
              {deleteLabel}
            </Button>
          )}
          <View className="ml-auto flex-row items-center gap-2">
            <Button variant="outline" onPress={close} disabled={saving}>
              Cancel
            </Button>
            <Button onPress={submit} disabled={!canSubmit || saving}>
              {saving ? 'Saving…' : submitLabel}
            </Button>
          </View>
        </View>
      </View>

      {/* Close — absolutely positioned so it never steals the first field's
          autofocus. `h-11 w-11` (44dp) is the measured pressable target
          itself, not just hit-slop padding around a 16px icon. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={close}
        className="absolute right-1 top-6 h-11 w-11 items-center justify-center"
      >
        <X size={16} className="text-foreground" />
      </Pressable>
    </BottomSheet>
  );
});

// ── Layout helpers ──────────────────────────────────────────────────────

/** A titled group of fields in the sheet body. */
export function FormSection({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={cn('gap-1.5', className)}>
      {title && <Text className="px-1 text-micro-label uppercase text-muted-foreground">{title}</Text>}
      {/* H4: one border level per view — the sheet chrome already owns the
          border, so the group is an inset FILL with hairline dividers
          between rows, never its own border. */}
      <View className="overflow-hidden rounded-xl bg-muted/30">
        {React.Children.toArray(children).map((child, index) => (
          <React.Fragment key={index}>
            {index > 0 && <View className="h-px bg-border/60" />}
            <View className="px-3.5 py-3">{child}</View>
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

/**
 * Quick/Details split — wraps the less-frequently-edited fields of a sheet
 * behind a "Show N more details" disclosure so the always-relevant fields
 * fit above the on-screen keyboard without scrolling.
 */
export function DetailsDisclosure({
  count,
  children,
  className,
}: {
  /** Number of fields hidden behind the disclosure (shown in its label). */
  count: number;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  if (open) {
    return <View className={cn('gap-4', className)}>{children}</View>;
  }

  return (
    <Pressable onPress={() => setOpen(true)} className={className}>
      <Text className="text-sm font-medium text-primary">
        Show {count} more detail{count === 1 ? '' : 's'}
      </Text>
    </Pressable>
  );
}

/** A labelled field row: label (+ optional inline action), control, inline error. */
export function FieldRow({
  label,
  required,
  action,
  error,
  hint,
  children,
  className,
}: {
  label?: string;
  required?: boolean;
  /** Right-aligned control next to the label (e.g. a Clear button). */
  action?: React.ReactNode;
  error?: string | null;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={cn('gap-1.5', className)}>
      {(label || action) && (
        <View className="flex-row items-center justify-between gap-2">
          {label && (
            <Text className="text-sm font-medium text-foreground">
              {label}
              {required && <Text className="text-destructive"> *</Text>}
            </Text>
          )}
          {action}
        </View>
      )}
      {children}
      {error ? (
        <Text className="text-xs text-destructive">{error}</Text>
      ) : hint ? (
        <Text className="text-xs text-muted-foreground">{hint}</Text>
      ) : null}
    </View>
  );
}
