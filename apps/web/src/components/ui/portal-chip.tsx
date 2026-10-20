'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { pillVariants } from '@/components/ui/pill';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { tagPortalMorph } from '@/lib/view-transitions';

// Hearth §6 "The portal contract" (PC1-6): the ONE tappable shape for a row's
// nouns-with-a-destination (comments, attachments, tags, a reminder, a
// recipe). Plain meta text is never tappable — a portal always renders as a
// PortalChip. See `.docs/design/hearth.md` §6.

interface PortalChipProps extends Omit<React.ComponentProps<'button'>, 'onClick'> {
  icon?: React.ReactNode;
  label: React.ReactNode;
  /** PC5: accent = the tap leaves the section (e.g. recipe from groceries); neutral = opens in place (comments, attachments, tags). */
  tone?: 'accent' | 'neutral';
  /**
   * Hearth §8.1 portal jump: when set, tags this chip with the given
   * `view-transition-name` right before `onOpen()` fires, so a matching
   * name on the destination (e.g. its header) morphs from this chip on
   * supported browsers. Only meaningful for `tone: 'accent'` chips that
   * navigate away — leave unset for in-place (bottom sheet) portals.
   */
  morphName?: string;
  onOpen: () => void;
}

function PortalChip({ icon, label, tone = 'neutral', morphName, className, onOpen, ...props }: PortalChipProps) {
  return (
    <button
      type="button"
      data-slot="portal-chip"
      onClick={(e) => {
        // PC2: a portal tap stops there, it never also opens the row.
        e.stopPropagation();
        if (morphName) tagPortalMorph(e.currentTarget, morphName);
        onOpen();
      }}
      className={cn(
        pillVariants({ variant: tone === 'accent' ? 'primary' : 'muted' }),
        // PC3: pad to a ~44px hit target at the 20px (h-5) visual pill height
        // via an invisible oversized ::before rather than growing the row's
        // layout. Asymmetric on purpose (FLUX-1554): ±12px vertically closes
        // the 20→44px gap, but ±10px horizontally would out-reach the row's
        // `gap-2` (8px) and make adjacent chips' hit zones overlap — `isolate`
        // then hands the whole overlap to whichever chip sits later in the
        // DOM, so a tap in the gap silently opened the wrong portal. ±4px
        // horizontally reaches exactly to the middle of the gap, never past it.
        'relative isolate before:absolute before:-inset-x-1 before:-inset-y-3 before:content-[""]',
        className
      )}
      {...props}
    >
      {icon}
      {label}
    </button>
  );
}

interface PortalChipDef {
  key: string;
  icon?: React.ReactNode;
  label: React.ReactNode;
  tone?: 'accent' | 'neutral';
  /** See `PortalChipProps.morphName`. */
  morphName?: string;
  onOpen: () => void;
}

interface PortalChipRowProps {
  chips: PortalChipDef[];
  className?: string;
  /** Label for the "+N" overflow sheet. Default "More". */
  overflowTitle?: string;
}

/**
 * PC4: renders at most three portal chips, then a "+N" overflow chip that
 * opens the rest as a bottom sheet list.
 */
function PortalChipRow({ chips, className, overflowTitle = 'More' }: PortalChipRowProps) {
  const [overflowOpen, setOverflowOpen] = React.useState(false);
  if (chips.length === 0) return null;

  const visible = chips.slice(0, 3);
  const overflow = chips.slice(3);

  return (
    // HOUP-253: `w-full min-w-0` so the chip row claims its container's
    // available width and wraps chips inside it, instead of sizing to its
    // own intrinsic (unwrapped) content width when nested in a flex parent.
    <div data-slot="portal-chip-row" className={cn('w-full min-w-0 flex flex-wrap items-center gap-2', className)}>
      {visible.map((chip) => (
        <PortalChip
          key={chip.key}
          icon={chip.icon}
          label={chip.label}
          tone={chip.tone}
          morphName={chip.morphName}
          onOpen={chip.onOpen}
        />
      ))}
      {overflow.length > 0 && (
        <>
          <PortalChip label={`+${overflow.length}`} tone="neutral" onOpen={() => setOverflowOpen(true)} />
          <BottomSheet
            open={overflowOpen}
            onOpenChange={setOverflowOpen}
            className="z-[60] max-h-[60vh] w-full gap-0 overflow-y-auto overscroll-none rounded-t-2xl border border-border bg-popover/95 py-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl shadow-2xl shadow-black/50"
            overlayClassName="z-[59]"
          >
            <div className="px-3.5 pb-1 pt-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              {overflowTitle}
            </div>
            <div className="flex flex-col gap-0.5 px-1.5 pb-1">
              {overflow.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => {
                    setOverflowOpen(false);
                    chip.onOpen();
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-accent/50"
                >
                  {chip.icon}
                  {chip.label}
                </button>
              ))}
            </div>
          </BottomSheet>
        </>
      )}
    </div>
  );
}

export { PortalChip, PortalChipRow, type PortalChipDef };
