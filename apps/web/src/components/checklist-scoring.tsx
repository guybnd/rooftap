"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { use$ } from "@legendapp/state/react";
import { AlertTriangle, Check, CheckCircle2, Circle, ClipboardCheck, X, XCircle, ShieldAlertIcon, SparklesIcon } from "lucide-react";
import { calculateScore, apartmentChecklistResponses$, useReconnectSync, useStoreHelpers } from '@homeup/core';
import { ScoreBadge } from "@/components/score-badge";
import { cn } from "@/lib/utils";
import type { ChecklistItem, ChecklistResponse } from '@homeup/core';

type ResponseValue = boolean | null;

interface ChecklistScoringProps {
  apartmentId: string;
  items: ChecklistItem[];
  initialResponses: ChecklistResponse[];
}

// FLUX-150 slice 6: responses read/write through Legend (apartmentChecklistResponses$)
// instead of direct Supabase calls. `initialResponses` is accepted (the parent —
// out of scope here, migrated separately — still passes it) but no longer used;
// the store is the source of truth. `items` all share one group_id (they're the
// group's scoring checklist), so it's derived from there rather than threaded
// through as a prop.
export function ChecklistScoring({ apartmentId, items }: ChecklistScoringProps) {
  const groupId = items[0]?.group_id;
  const responsesStore$ = apartmentChecklistResponses$(groupId);
  useReconnectSync(responsesStore$);
  const { writeRow, patchRow, softDeleteRow } = useStoreHelpers(responsesStore$, null);

  // Includes soft-deleted rows — needed so syncResponse can revive one instead
  // of inserting a duplicate (apartment_id, checklist_item_id) row, which the
  // DB's unique constraint would reject.
  const allResponses = use$(() =>
    Object.values(responsesStore$.get() ?? {}).filter(
      (r): r is ChecklistResponse => !!r && r.apartment_id === apartmentId
    )
  );

  const responses = useMemo(() => {
    const map: Record<string, ResponseValue> = {};
    for (const r of allResponses) {
      if (!r.deleted) map[r.checklist_item_id] = r.value;
    }
    return map;
  }, [allResponses]);

  const score = useMemo(() => {
    const hasAny = Object.values(responses).some((v) => v !== undefined);
    if (!hasAny) return null;
    return calculateScore(items, responses);
  }, [items, responses]);

  const categories = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const item of [...items].sort((a, b) => a.order - b.order)) {
      const cat = item.category || "General";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return map;
  }, [items]);

  const progress = useMemo(() => {
    const answered = items.filter((i) => responses[i.id] !== undefined && responses[i.id] !== null).length;
    return { answered, total: items.length, percent: items.length > 0 ? Math.round((answered / items.length) * 100) : 0 };
  }, [items, responses]);

  const syncResponse = useCallback((itemId: string, value: ResponseValue) => {
    if (!groupId) return;
    // Look up by id (not filtered by deleted) — reviving a soft-deleted row
    // via patchRow avoids violating the (apartment_id, checklist_item_id)
    // unique constraint that a fresh writeRow would hit.
    const existing = allResponses.find((r) => r.checklist_item_id === itemId);
    if (existing) {
      if (value === null) {
        softDeleteRow(existing.id);
      } else {
        patchRow(existing.id, { value, deleted: false });
      }
    } else if (value !== null) {
      writeRow({
        id: crypto.randomUUID(),
        group_id: groupId,
        apartment_id: apartmentId,
        checklist_item_id: itemId,
        value,
        notes: null,
        deleted: false,
        created_at: null as unknown as string,
        updated_at: null as unknown as string,
      });
    }
  }, [groupId, apartmentId, allResponses, writeRow, patchRow, softDeleteRow]);

  const cycleValue = useCallback((itemId: string) => {
    const current = responses[itemId];
    let next: ResponseValue;
    if (current === undefined || current === null) next = true;
    else if (current === true) next = false;
    else next = null;
    syncResponse(itemId, next);
  }, [responses, syncResponse]);

  const setValueDirect = useCallback((itemId: string, value: boolean) => {
    const current = responses[itemId];
    const next: ResponseValue = current === value ? null : value;
    syncResponse(itemId, next);
  }, [responses, syncResponse]);

  const isDealbreaker = (itemId: string) =>
    score?.dealbreakers.includes(itemId) ?? false;

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        No checklist items yet. Add items in the Checklist page to start scoring.
      </div>
    );
  }

  // Hearth v2 pass: Title-step heading, answered count as a caption with a
  // local 52px meter (H3: no edge-to-edge status bars), each category is a
  // micro label over one card of divided rows (H4), and an item's type is a
  // meta word ("Dealbreaker", "Bonus"; required is the silent default)
  // instead of an 8px chip (T4). State is the glyph's tint, never a row fill.
  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
            Checklist
          </h2>
          {score && (
            <div className="flex items-center gap-3">
              {score.dealbreakers.length > 0 && (
                <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {score.dealbreakers.length === 1
                    ? "Dealbreaker"
                    : `${score.dealbreakers.length} dealbreakers`}
                </span>
              )}
              <ScoreBadge
                percentage={score.percentage}
                hasDealbreakers={score.dealbreakers.length > 0}
                size="sm"
              />
            </div>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">{progress.answered} of {progress.total} answered</span>
          <LocalMeter percent={progress.percent} className="bg-success" />
        </div>
      </div>

      {/* Categories */}
      <div className="space-y-5">
        {Array.from(categories.entries()).map(([category, categoryItems]) => {
          const catAnswered = categoryItems.filter((i) => responses[i.id] !== undefined && responses[i.id] !== null).length;
          const catYes = categoryItems.filter((i) => responses[i.id] === true).length;
          const catPercent = catAnswered > 0 ? Math.round((catYes / catAnswered) * 100) : 0;

          return (
            <div key={category}>
              {/* Category: micro label, then its pass count with a local meter */}
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {category}
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {catYes} of {categoryItems.length} pass
                  </span>
                  <LocalMeter
                    percent={catAnswered > 0 ? (catYes / categoryItems.length) * 100 : 0}
                    className={
                      catPercent >= 80 ? "bg-success" :
                      catPercent >= 60 ? "bg-warning" :
                      "bg-destructive"
                    }
                  />
                </div>
              </div>

              {/* Items: one card, divided rows */}
              <div className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]">
                {categoryItems.map((item) => {
                  const value = responses[item.id];
                  const triggered = isDealbreaker(item.id);

                  return (
                    <SwipeableItem
                      key={item.id}
                      onSwipeRight={() => setValueDirect(item.id, true)}
                      onSwipeLeft={() => setValueDirect(item.id, false)}
                      onClick={() => cycleValue(item.id)}
                      disabled={false}
                    >
                      {/* State indicator */}
                      <ResponseIcon value={value} triggered={triggered} />

                      {/* Label, with the item's type as a meta word */}
                      <div className="min-w-0 flex-1">
                        <span className={cn(
                          "block truncate text-sm",
                          triggered ? "text-destructive" :
                          value === true || value === false ? "text-foreground" :
                          "text-muted-foreground"
                        )}>
                          {item.label}
                        </span>
                        <ItemTypeMeta item={item} triggered={triggered} />
                      </div>

                      {/* Weight: a local 3px meter and its figure */}
                      <div className="flex shrink-0 items-center gap-2" aria-label={`Weight ${item.weight} of 10`}>
                        <LocalMeter
                          percent={(item.weight / 10) * 100}
                          className={
                            triggered ? "bg-destructive" :
                            value === true ? "bg-success" :
                            "bg-foreground/30"
                          }
                        />
                        <span className="w-4 text-right text-xs tabular-nums text-muted-foreground">
                          {item.weight}
                        </span>
                      </div>
                    </SwipeableItem>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Local meter (H3: ~52px inline, 3px tall) ────────────────────────────────

function LocalMeter({ percent, className }: { percent: number; className?: string }) {
  return (
    <span className="block h-[3px] w-[52px] shrink-0 overflow-hidden rounded-full bg-muted">
      <span
        className={cn("block h-full rounded-full transition-all duration-300", className)}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </span>
  );
}

// ─── Response State Icon ─────────────────────────────────────────────────────

function ResponseIcon({ value, triggered }: { value: ResponseValue; triggered: boolean }) {
  if (value === true) {
    return <CheckCircle2 className="size-[18px] shrink-0 text-success" aria-label="Yes" />;
  }
  if (value === false) {
    return (
      <XCircle
        className={cn("size-[18px] shrink-0", triggered ? "text-destructive" : "text-muted-foreground")}
        aria-label="No"
      />
    );
  }
  return <Circle className="size-[18px] shrink-0 text-muted-foreground/40" aria-label="Unanswered" />;
}

// ─── Swipeable Item ──────────────────────────────────────────────────────────

const SWIPE_THRESHOLD = 50;

function SwipeableItem({
  children,
  onSwipeRight,
  onSwipeLeft,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  onClick: () => void;
  disabled: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const currentX = useRef(0);
  const didSwipe = useRef(false);
  const locked = useRef<"horizontal" | "vertical" | null>(null);
  const [dragX, setDragX] = useState(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    startX.current = e.clientX;
    startY.current = e.clientY;
    currentX.current = 0;
    didSwipe.current = false;
    locked.current = null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (startX.current === null || startY.current === null) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;

    if (!locked.current) {
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        locked.current = Math.abs(dy) > Math.abs(dx) ? "vertical" : "horizontal";
        if (locked.current === "vertical") {
          startX.current = null;
          return;
        }
      } else {
        return;
      }
    }

    if (locked.current === "vertical") return;

    didSwipe.current = Math.abs(dx) > 10;
    currentX.current = dx;
    const clamped = Math.max(-100, Math.min(100, dx));
    setDragX(clamped);
    if (rowRef.current) {
      rowRef.current.style.transform = `translateX(${clamped}px)`;
      rowRef.current.style.transition = "none";
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    if (rowRef.current) {
      rowRef.current.style.transform = "";
      rowRef.current.style.transition = "transform 200ms ease-out";
    }
    setDragX(0);

    const wasSwipe = locked.current === "horizontal";

    if (wasSwipe) {
      if (currentX.current > SWIPE_THRESHOLD) {
        onSwipeRight();
      } else if (currentX.current < -SWIPE_THRESHOLD) {
        onSwipeLeft();
      }
    }

    didSwipe.current = wasSwipe;
    startX.current = null;
    startY.current = null;
    currentX.current = 0;
    locked.current = null;
  };

  const handleClick = (e: React.MouseEvent) => {
    if (didSwipe.current) {
      e.preventDefault();
      e.stopPropagation();
      didSwipe.current = false;
      return;
    }
    onClick();
  };

  const swipeDirection = dragX > 0 ? "right" : dragX < 0 ? "left" : null;
  const swipeOpacity = Math.min(Math.abs(dragX) / SWIPE_THRESHOLD, 1);

  return (
    <div ref={containerRef} className="relative overflow-hidden">
      {/* Action revealed underneath - only the relevant side */}
      {swipeDirection === "right" && (
        <div
          className="absolute inset-0 flex items-center pl-4 bg-success/15"
          style={{ opacity: swipeOpacity }}
        >
          <Check className="size-5 text-success" strokeWidth={2.5} />
          <span className="ml-2 text-xs font-medium text-success">Yes</span>
        </div>
      )}
      {swipeDirection === "left" && (
        <div
          className="absolute inset-0 flex items-center justify-end pr-4 bg-destructive/15"
          style={{ opacity: swipeOpacity }}
        >
          <span className="mr-2 text-xs font-medium text-destructive">No</span>
          <X className="size-5 text-destructive" strokeWidth={2.5} />
        </div>
      )}

      {/* Row content that moves with finger */}
      <div
        ref={rowRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className={cn(
          "relative flex min-h-11 items-center gap-3 bg-card px-4 py-2.5 text-left cursor-pointer select-none touch-pan-y",
          "hover:bg-muted/40 active:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          disabled && "opacity-50 pointer-events-none"
        )}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Item Type Meta ──────────────────────────────────────────────────────────

function ItemTypeMeta({ item, triggered }: { item: ChecklistItem; triggered: boolean }) {
  if (item.is_dealbreaker) {
    return (
      <span className={cn(
        "mt-0.5 flex items-center gap-1 text-xs",
        triggered ? "font-medium text-destructive" : "text-muted-foreground"
      )}>
        <ShieldAlertIcon className="size-3" />
        Dealbreaker
      </span>
    );
  }
  if (item.is_bonus) {
    return (
      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
        <SparklesIcon className="size-3" />
        Bonus
      </span>
    );
  }
  return null;
}
