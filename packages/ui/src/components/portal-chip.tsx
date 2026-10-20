// HOUP-68: native port of apps/web/src/components/ui/portal-chip.tsx (Hearth
// §6 "The portal contract", PC1-6). `morphName`/view-transition tagging is a
// web-only affordance (browser View Transitions API) with no RN equivalent —
// dropped; PC5 tone semantics and PC2 (a portal tap never bubbles to the row)
// carry over via `onStartShouldSetResponder`-free plain `onPress` (RN
// Pressables don't bubble press events to ancestor Pressables the way DOM
// click events bubble, so PC2 needs no extra stopPropagation call here).
import * as React from 'react';
import { Pressable, Text, View, type ViewProps } from 'react-native';
import { cn } from '../lib/cn';
import { pillVariants, pillTextVariants, pillTextStyle } from './pill';
import { BottomSheet } from './bottom-sheet';
import { ListGroup, ListItem, ListItemLeading, ListItemTitle } from './list-item';

export interface PortalChipProps {
  icon?: React.ReactNode;
  label: React.ReactNode;
  /** PC5: accent = the tap leaves the section (e.g. recipe from groceries); neutral = opens in place (comments, attachments, tags). */
  tone?: 'accent' | 'neutral';
  onOpen: () => void;
  className?: string;
  /** Names an icon-only chip (a null label) for screen readers. */
  accessibilityLabel?: string;
}

function PortalChip({ icon, label, tone = 'neutral', onOpen, className, accessibilityLabel }: PortalChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onOpen}
      // PC3: pad to a ~44px hit target beyond the 20px (h-5) visual pill
      // height via an oversized invisible hitSlop, rather than growing the
      // row's layout. Asymmetric (FLUX-1554, mirrors the web hit-slop fix):
      // a uniform 10px slop plus the row's `gap-2` (8px) let adjacent chips'
      // hit zones overlap, so a tap in the gap could route to the wrong chip.
      // ±12px vertically closes the 20→44px gap; ±4px horizontally reaches
      // only to the middle of the gap, never past it.
      hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
      className={cn(pillVariants({ variant: tone === 'accent' ? 'primary' : 'muted' }), className)}
    >
      {icon}
      {typeof label === 'string' || typeof label === 'number' ? (
        <Text
          className={cn(pillTextVariants({ variant: tone === 'accent' ? 'primary' : 'muted' }))}
          style={pillTextStyle}
        >
          {label}
        </Text>
      ) : (
        label
      )}
    </Pressable>
  );
}

export interface PortalChipDef {
  key: string;
  icon?: React.ReactNode;
  label: React.ReactNode;
  tone?: 'accent' | 'neutral';
  onOpen: () => void;
  /** Names an icon-only chip (a null label) for screen readers. */
  accessibilityLabel?: string;
}

export interface PortalChipRowProps extends ViewProps {
  chips: PortalChipDef[];
  /** Label for the "+N" overflow sheet. Default "More". */
  overflowTitle?: string;
}

/**
 * PC4: renders at most three portal chips, then a "+N" overflow chip that
 * opens the rest as a bottom sheet list.
 */
function PortalChipRow({ chips, className, overflowTitle = 'More', ...props }: PortalChipRowProps) {
  const [overflowOpen, setOverflowOpen] = React.useState(false);
  if (chips.length === 0) return null;

  const visible = chips.slice(0, 3);
  const overflow = chips.slice(3);

  return (
    // HOUP-253: `w-full min-w-0` so the chip row claims its container's
    // available width and wraps chips inside it, instead of sizing to its
    // own intrinsic (unwrapped) content width when nested in a flex parent.
    <View className={cn('w-full min-w-0 flex-row flex-wrap items-center gap-2', className)} {...props}>
      {visible.map((chip) => (
        <PortalChip key={chip.key} icon={chip.icon} label={chip.label} tone={chip.tone} onOpen={chip.onOpen} accessibilityLabel={chip.accessibilityLabel} />
      ))}
      {overflow.length > 0 && (
        <>
          <PortalChip label={`+${overflow.length}`} tone="neutral" onOpen={() => setOverflowOpen(true)} />
          <BottomSheet open={overflowOpen} onOpenChange={setOverflowOpen} className="pb-4">
            <Text className="px-3.5 pb-1 pt-1 text-micro-label uppercase text-muted-foreground">
              {overflowTitle}
            </Text>
            <ListGroup className="mx-1.5 border-0 bg-transparent">
              {overflow.map((chip) => (
                <ListItem
                  key={chip.key}
                  onPress={() => {
                    setOverflowOpen(false);
                    chip.onOpen();
                  }}
                >
                  {chip.icon && <ListItemLeading>{chip.icon}</ListItemLeading>}
                  <ListItemTitle>{chip.label ?? chip.accessibilityLabel}</ListItemTitle>
                </ListItem>
              ))}
            </ListGroup>
          </BottomSheet>
        </>
      )}
    </View>
  );
}

export { PortalChip, PortalChipRow };
