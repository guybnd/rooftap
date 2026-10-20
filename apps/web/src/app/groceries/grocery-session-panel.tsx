'use client';

import { useRef, useState } from 'react';
import type { GrocerySession, GroceryItem } from '@homeup/core';
import { formatMoney, useModules, currencySymbol } from '@homeup/core';
import {
  ensureSession,
  updateSession,
  applyReceiptLearning,
  receiptSignedUrl,
  effectiveSessionTotal,
} from '@homeup/core';
import { uploadReceipt } from '@/lib/grocery-sessions';
import { Receipt, X, Camera, Check, ScanLine, Pencil, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { parseReceiptFile } from '@/lib/grocery-receipt-parse';

interface Props {
  groupId: string;
  session: GrocerySession | null;
  summedCents: number;
  boughtCount: number;
  unpricedCount: number;
  items: GroceryItem[];
  onChange: (session: GrocerySession | null) => void;
  onItemsChanged: () => void;
  /** Hide the floating ask (e.g. while Select's bulk bar is up). */
  hidePrompt?: boolean;
}

export function GrocerySessionPanel({
  groupId,
  session,
  summedCents,
  boughtCount,
  unpricedCount,
  items,
  onChange,
  onItemsChanged,
  hidePrompt,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [overrideVal, setOverrideVal] = useState('');
  const [scanning, setScanning] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();
  const modules = useModules();
  // Modules: the trip only lands in Costs when costs and groceries are both on (module-features.ts).
  const toCosts = modules.feature('costs.from-groceries');

  // ── No decision yet, but items are in the cart → floating ask ─────────────
  // Floats above the tab bar in the accent colour (its own layer, so it
  // doesn't spend the content's H5 accent budget, Guy's call) instead of a
  // card that pushes the list down. Steps aside while Select's bulk bar
  // owns the bottom edge.
  if (boughtCount > 0 && session === null) {
    if (hidePrompt) return null;
    return (
      <div
        role="alert"
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-4 left-1/2 z-40 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-2xl bg-primary py-2.5 pl-4 pr-2 text-primary-foreground shadow-xl shadow-black/40 animate-in fade-in slide-in-from-bottom-2 duration-[var(--motion-slow)]"
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

  // Skipped / dismissed for today: the way back is TrackShopLink, a small
  // link the page puts beside Reset bought.
  if (session?.tracking !== 'on') return null;

  // ── Active session ──────────────────────────────────────────────────────────
  const effective = effectiveSessionTotal({ ...session, summed_total_cents: summedCents });
  const source =
    session.override_total_cents != null ? 'manual total'
    : session.receipt_total_cents != null ? 'from receipt'
    : 'estimated';

  const saveOverride = async () => {
    const dollars = parseFloat(overrideVal);
    const cents = isNaN(dollars) || dollars < 0 ? null : Math.round(dollars * 100);
    setOverriding(false);
    onChange(await updateSession(supabase, session.id, { override_total_cents: cents }));
  };

  const onPickFile = async (file: File) => {
    fileRef.current = file;
    setUploadError(null);
    setBusy(true);
    try {
      const up = await uploadReceipt(supabase, groupId, session.session_date, file);
      if (up) onChange(await updateSession(supabase, session.id, { receipt_path: up.path, receipt_name: up.name }));
      else setUploadError('Receipt upload failed. Tap to try again.');
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    setScanning(true);
    try {
      let file = fileRef.current;
      if (!file && session.receipt_path) {
        const url = await receiptSignedUrl(supabase, session.receipt_path);
        if (url) {
          const blob = await (await fetch(url)).blob();
          file = new File([blob], session.receipt_name ?? 'receipt', { type: blob.type });
        }
      }
      if (!file) return;
      const parsed = await parseReceiptFile(file);
      if (!parsed) return;
      const patch: Partial<GrocerySession> = {};
      if (parsed.total != null) patch.receipt_total_cents = Math.round(parsed.total * 100);
      if (parsed.retailer) patch.retailer = parsed.retailer;
      if (Object.keys(patch).length) onChange(await updateSession(supabase, session.id, patch));
      await applyReceiptLearning(supabase, groupId, parsed, items);
      onItemsChanged();
    } finally {
      setScanning(false);
    }
  };

  const iconBtn =
    'h-9 w-9 grid place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 transition-colors disabled:opacity-50 flex-shrink-0';

  // Compact, single-row bar that sticks to the top of the list while scrolling.
  return (
    <div className="sticky top-0 z-30 -mx-4 md:-mx-6 px-4 md:px-6 pt-1 pb-2 bg-background/70 backdrop-blur-md">
      <div className="flex items-center gap-2.5 rounded-3xl border border-border/60 bg-card/90 backdrop-blur-xl px-3.5 py-2 shadow-[var(--card-shadow)]">
        <Receipt className="h-5 w-5 text-muted-foreground flex-shrink-0" />
        <span className="hidden sm:inline text-sm font-medium text-foreground flex-shrink-0">Today&apos;s shop</span>

        {/* Total + source */}
        {overriding ? (
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-muted-foreground text-sm">{currencySymbol()}</span>
            <input
              type="number"
              inputMode="decimal"
              autoFocus
              value={overrideVal}
              onChange={(e) => setOverrideVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveOverride(); if (e.key === 'Escape') setOverriding(false); }}
              placeholder="0.00"
              className="w-20 bg-input border border-border rounded-lg px-2 py-1 text-foreground text-lg font-bold tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button onClick={() => void saveOverride()} aria-label="Save total" className="text-primary hover:text-primary/80 p-1"><Check className="h-4 w-4" /></button>
            <button onClick={() => setOverriding(false)} aria-label="Cancel" className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <button
            onClick={() => { setOverrideVal(String(effective / 100)); setOverriding(true); }}
            title="Tap to override the total"
            className="flex items-baseline gap-2 min-w-0 group"
          >
            <span className="text-base font-semibold text-foreground tabular-nums leading-none">{formatMoney(effective)}</span>
            <span className="hidden sm:inline text-[11px] text-muted-foreground group-hover:text-foreground">{source}</span>
          </button>
        )}

        {/* Got / unpriced */}
        {!overriding && (
          <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0 whitespace-nowrap">
            {boughtCount} got
            {unpricedCount > 0 && <span className="text-warning"> · {unpricedCount} no&nbsp;price</span>}
          </span>
        )}

        {/* Actions */}
        <div className="ml-auto flex items-center gap-0.5 flex-shrink-0">
          {!overriding && (
            <button
              onClick={() => { setOverrideVal(String(effective / 100)); setOverriding(true); }}
              title="Override total"
              aria-label="Override total"
              className={iconBtn}
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            title={session.receipt_path ? 'Replace receipt' : 'Add receipt'}
            aria-label={session.receipt_path ? 'Replace receipt' : 'Add receipt'}
            className={iconBtn + (session.receipt_path ? ' text-foreground' : '')}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickFile(f); e.target.value = ''; }}
          />
          {session.receipt_path && (
            <button
              disabled={scanning}
              onClick={() => void scan()}
              title={scanning ? 'Scanning…' : 'Scan receipt'}
              aria-label={scanning ? 'Scanning receipt' : 'Scan receipt'}
              className={iconBtn + ' text-foreground ' + (scanning ? 'animate-pulse' : '')}
            >
              <ScanLine className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={async () => { onChange(await updateSession(supabase, session.id, { tracking: 'skipped' })); }}
            title="Stop tracking today"
            aria-label="Stop tracking today"
            className={iconBtn}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Confirmation / status sub-line — uploading, attached, or error */}
      {(busy || uploadError || session.receipt_path) && (
        <div className="mt-1 px-2 text-[11px] leading-tight">
          {busy ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Uploading receipt…
            </span>
          ) : uploadError ? (
            <button onClick={() => inputRef.current?.click()} className="text-destructive hover:text-destructive/80">
              {uploadError}
            </button>
          ) : session.receipt_path ? (
            <span className="flex items-center gap-1.5 text-muted-foreground min-w-0">
              <Receipt className="h-3 w-3 flex-shrink-0" />
              <span className="truncate text-foreground/80">{session.receipt_name ?? 'Receipt'} attached</span>
              {session.receipt_total_cents == null && (
                <span className="text-muted-foreground flex-shrink-0 whitespace-nowrap">· tap scan to read total</span>
              )}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** The quiet way back after "Not today" (or stopping): a small text link
 *  that sits beside Reset bought rather than a full-width pill. */
export function TrackShopLink({ session, onChange }: { session: GrocerySession; onChange: (session: GrocerySession | null) => void }) {
  const [busy, setBusy] = useState(false);
  const supabase = createClient();
  return (
    <button
      disabled={busy}
      onClick={async () => { setBusy(true); onChange(await updateSession(supabase, session.id, { tracking: 'on' })); setBusy(false); }}
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      <Receipt className="h-3 w-3" />
      Track shop
    </button>
  );
}
