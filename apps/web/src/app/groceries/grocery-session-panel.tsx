'use client';

// HOUP-80/HOUP-226: today's shop, web twin of
// apps/mobile/src/features/groceries/grocery-session-panel.tsx.
//
// The whole trip lives in floating layers above the tab bar, never in the
// list: TrackShopPrompt asks (accent), then once tracking is on
// ShopTrackingPill holds the running total (tap to override), Receipt and
// Done, however far the list scrolls. Done opens FinishShopSheet: scan the
// receipt and finish in one move (reads the total, learns prices), or a
// photo, or no receipt (Guy, 2026-10-20). Once skipped, the way back is
// "Track shop" in the head's More menu and the This trip card. The page owns
// the receipt picker and the finish flow (it owns Done shopping's undo).

import { useRef, useState } from 'react';
import type { GrocerySession } from '@homeup/core';
import { formatMoney, useModules, currencySymbol, ensureSession, updateSession, sessionTotalSource } from '@homeup/core';
import { Receipt, Camera, Check, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { cn } from '@/lib/utils';

// The floating layers' one spot: clears the phone tab bar and its raised
// capture button (the bar is in-flow), bottom-4 on desktop. The ask and the
// pill never show together, so they share it.
const FLOAT_SPOT =
  'fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-4 left-1/2 z-40 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2';
// MO: the floating layers rise in at slow, like a sheet arriving.
const FLOAT_ENTER = 'animate-in fade-in slide-in-from-bottom-2 duration-[var(--motion-slow)]';

/** The trip's total; tapping it swaps in an input to override it (Enter or
 *  blur commits, empty clears the override, Escape backs out). H1: body
 *  weight in the pill, the Display step in the sheet (the screen's lede is
 *  the only Hero); T3: money stays out of mono, tabular figures align it. */
function EditableTotal({
  total,
  caption,
  onOverrideTotal,
  size = 'body',
}: {
  total: number;
  caption: string;
  onOverrideTotal: (cents: number | null) => void;
  size?: 'body' | 'display';
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Enter commits and unmounts the input; a trailing blur must not commit twice.
  const doneRef = useRef(false);

  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const parsed = parseFloat(draft);
    onOverrideTotal(draft.trim() === '' || Number.isNaN(parsed) || parsed < 0 ? null : Math.round(parsed * 100));
    setEditing(false);
  };
  const cancel = () => { doneRef.current = true; setEditing(false); };

  if (editing) {
    return (
      <div className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1">
        <span className="text-sm text-muted-foreground">{currencySymbol()}</span>
        <input
          type="number"
          inputMode="decimal"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
          onBlur={commit}
          placeholder="0.00"
          aria-label="Trip total"
          className="h-11 w-28 min-w-0 rounded-lg border border-border bg-input px-2 text-base font-semibold tabular-nums text-foreground focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        {/* M2: 44px. mousedown keeps focus so the tap commits once, here. */}
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          aria-label="Save total"
          className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-full text-primary transition-colors hover:bg-foreground/10"
        >
          <Check className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => { doneRef.current = false; setDraft(String(total / 100)); setEditing(true); }}
      title="Tap to change the total"
      aria-label={`${formatMoney(total)}, ${caption}. Change total`}
      className="flex min-h-[44px] min-w-0 flex-1 flex-col items-start justify-center text-left"
    >
      <span
        className={cn(
          'max-w-full truncate tabular-nums text-foreground',
          size === 'display' ? 'font-heading text-2xl font-bold leading-tight tracking-[-0.02em]' : 'text-sm font-semibold leading-tight'
        )}
      >
        {formatMoney(total)}
      </span>
      <span className="w-full truncate text-xs tabular-nums text-muted-foreground">{caption}</span>
    </button>
  );
}

/** Floating accent ask to track today's shop once something is in the cart
 *  and no decision has been made yet. In the accent (its own layer, so it
 *  doesn't spend the content's H5 accent budget, Guy's call) instead of a
 *  card that pushes the list down. The page hides it while Select's bulk bar
 *  owns the bottom edge, and while searching. */
export function TrackShopPrompt({
  groupId,
  boughtCount,
  summedCents,
  onChange,
}: {
  groupId: string;
  boughtCount: number;
  summedCents: number;
  onChange: (session: GrocerySession | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const supabase = createClient();
  const modules = useModules();
  // Modules: the trip only lands in Costs when costs and groceries are both on (module-features.ts).
  const toCosts = modules.feature('costs.from-groceries');

  return (
    <div
      role="alert"
      className={cn(FLOAT_SPOT, FLOAT_ENTER, 'flex items-center gap-3 rounded-2xl bg-primary py-2.5 pl-4 pr-2 text-primary-foreground shadow-xl shadow-black/40')}
    >
      <Receipt className="h-5 w-5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">Track today&apos;s shop?</p>
        <p className="truncate text-xs tabular-nums text-primary-foreground/80">
          {boughtCount} in cart · ~{formatMoney(summedCents)}{toCosts ? ' · adds to Costs' : ''}
        </p>
      </div>
      <button
        disabled={busy}
        onClick={async () => { setBusy(true); onChange(await ensureSession(supabase, groupId, 'skipped', summedCents)); setBusy(false); }}
        className="min-h-[44px] flex-shrink-0 rounded-xl px-2.5 text-sm text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground disabled:opacity-50"
      >
        Not today
      </button>
      <button
        disabled={busy}
        onClick={async () => { setBusy(true); onChange(await ensureSession(supabase, groupId, 'on', summedCents)); setBusy(false); }}
        className="min-h-[44px] flex-shrink-0 rounded-xl bg-primary-foreground px-4 text-sm font-semibold text-primary hover:opacity-90 disabled:opacity-50"
      >
        Track
      </button>
    </div>
  );
}

/** While a shop is tracked: a floating pill in the Track ask's spot, so the
 *  total, the receipt and Done stay under the thumb however far the list
 *  scrolls (Guy, 2026-10-20). A neutral popover, not the ask's accent: it's
 *  a standing tool, not a question. Done opens FinishShopSheet. */
export function ShopTrackingPill({
  session,
  total,
  boughtCount,
  onOverrideTotal,
  onReceipt,
  receiptBusy,
  receiptError,
  onDone,
}: {
  session: GrocerySession;
  /** The trip's effective total (override, receipt, else the live cart sum). */
  total: number;
  boughtCount: number;
  onOverrideTotal: (cents: number | null) => void;
  onReceipt: () => void;
  receiptBusy: boolean;
  receiptError: string | null;
  onDone: () => void;
}) {
  const source = sessionTotalSource(session);
  const caption = `${source === 'estimated' ? 'in cart' : source} · ${boughtCount} got`;
  return (
    <div className={cn(FLOAT_SPOT, FLOAT_ENTER, 'rounded-2xl border border-border bg-popover py-1.5 pl-4 pr-2 text-popover-foreground shadow-xl shadow-black/40')}>
      <div className="flex items-center gap-2">
        <EditableTotal total={total} caption={caption} onOverrideTotal={onOverrideTotal} />
        <button
          disabled={receiptBusy}
          onClick={onReceipt}
          aria-label={session.receipt_path ? 'Replace receipt' : 'Add receipt'}
          className="inline-flex min-h-[44px] flex-shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          {receiptBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
          Receipt
        </button>
        <button
          onClick={onDone}
          className="min-h-[44px] flex-shrink-0 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90"
        >
          Done
        </button>
      </div>
      {receiptError && (
        <button onClick={onReceipt} className="block w-full truncate pb-1 text-left text-xs text-destructive hover:text-destructive/80">
          {receiptError}
        </button>
      )}
    </div>
  );
}

/** Done's sheet: the trip's total (tap to override), then one move to scan
 *  the receipt and finish, with a photo or no receipt as the quieter choices.
 *  The sheet is its own layer, so its primary takes the accent (H5). */
export function FinishShopSheet({
  open,
  onOpenChange,
  session,
  total,
  boughtCount,
  unpricedCount,
  onOverrideTotal,
  onScan,
  onPickPhoto,
  onFinishWithout,
  onStopTracking,
  busy,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: GrocerySession | null;
  total: number;
  boughtCount: number;
  unpricedCount: number;
  onOverrideTotal: (cents: number | null) => void;
  /** Picks a receipt (camera first on phones), reads it, then finishes. */
  onScan: () => void;
  /** The same, from a photo or PDF already on the device. */
  onPickPhoto: () => void;
  onFinishWithout: () => void;
  onStopTracking: () => void;
  busy: boolean;
  error: string | null;
}) {
  const modules = useModules();
  const toCosts = modules.feature('costs.from-groceries');
  const caption = session
    ? [sessionTotalSource(session), `${boughtCount} got`, unpricedCount > 0 ? `${unpricedCount} unpriced` : null].filter(Boolean).join(' · ')
    : '';
  const outline =
    'min-h-12 flex-1 rounded-xl border border-border text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50';
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      overlayClassName="bg-black/40"
      className="max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl shadow-black/50 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pt-4"
      handleClassName="sm:hidden"
      popupProps={{ 'aria-label': "Finish today's shop" }}
    >
      {session && (
        <div className="space-y-4 pt-1">
          <div className="space-y-1">
            <p className="font-heading text-base font-semibold text-foreground">Finish today&apos;s shop</p>
            <EditableTotal total={total} caption={caption} onOverrideTotal={onOverrideTotal} size="display" />
          </div>
          <button
            disabled={busy}
            onClick={onScan}
            className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-primary px-4 py-2 text-left text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin" /> : <Camera className="h-5 w-5 flex-shrink-0" />}
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">{busy ? 'Reading receipt…' : 'Scan receipt and finish'}</span>
              <span className="block text-xs text-primary-foreground/80">Reads the real total and learns prices</span>
            </span>
          </button>
          <div className="flex gap-2">
            <button disabled={busy} onClick={onPickPhoto} className={outline}>Pick a photo</button>
            <button disabled={busy} onClick={onFinishWithout} className={outline}>Finish without</button>
          </div>
          {error && <p className="text-center text-xs text-destructive">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{toCosts ? 'The trip adds to Costs either way' : 'Bought items move to Have it'}</p>
            <button
              disabled={busy}
              onClick={onStopTracking}
              className="min-h-[44px] flex-shrink-0 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Stop tracking
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

/** The quiet way back after "Not today" (or stopping): a small pill in the
 *  list's "This trip" card (`className` restyles it there); the head's More
 *  menu offers the same verb. */
export function TrackShopLink({
  session,
  onChange,
  className = 'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50',
}: {
  session: GrocerySession;
  onChange: (session: GrocerySession | null) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const supabase = createClient();
  return (
    <button
      disabled={busy}
      onClick={async () => { setBusy(true); onChange(await updateSession(supabase, session.id, { tracking: 'on' })); setBusy(false); }}
      className={className}
    >
      <Receipt className="h-3 w-3" />
      Track shop
    </button>
  );
}
