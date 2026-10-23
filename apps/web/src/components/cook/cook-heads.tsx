'use client';

// Recipes v2 R3: cooking heads over every screen (mockups 1C, 1D). Each
// running cook is a round head on the Recipes peach tile with its initials,
// a ring and a badge: the nearest timer, or the step when no timer runs.
// From three cooks on they stack into one pile.
//
// Drag a head to move the pile; it snaps to the nearest side edge and stays
// there (per browser). Drag it onto the target at the bottom to stop that
// cook, with Undo. Tap a head to open its card (the step, its timers,
// Back/Next and Open) over a dim layer; the other heads sit in a row above
// it to switch between cooks.
//
// Motion uses the Hearth tokens (MO): the snap rides --motion-settle on
// --motion-ease-out, and reduced motion makes it instant.

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import {
  DEFAULT_HEAD_DOCK,
  HEAD_GAP,
  HEAD_SIZE,
  HEADS_STACK_AT,
  cookBadge,
  cookInitials,
  isCookModePath,
  nearestTimer,
  overStopTarget,
  parseHeadDock,
  snapHeadDock,
  stopTargetCenter,
  timerProgress,
  useCookClock,
  useCooks,
  type HeadDock,
  type RunningCook,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { cn } from '@/lib/utils';
import { CookCard } from './cook-card';

const DOCK_KEY = 'rooftap.cook-heads';
const EDGE = 10;
// The phone tab bar's height, kept clear by the stop target.
const BOTTOM_INSET = 72;

function readDock(): HeadDock {
  try {
    return parseHeadDock(window.localStorage.getItem(DOCK_KEY));
  } catch {
    return DEFAULT_HEAD_DOCK;
  }
}

function saveDock(dock: HeadDock): void {
  try {
    window.localStorage.setItem(DOCK_KEY, JSON.stringify(dock));
  } catch {
    // Private windows keep the spot for this visit only.
  }
}

interface Drag {
  pointerId: number;
  cookId: string;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  moved: boolean;
}

export function CookHeads() {
  const { group, currentUserId } = useDataCache();
  const cooks = useCooks(group?.id, currentUserId);
  const router = useRouter();
  const pathname = usePathname();
  const list = cooks.cooks;
  const now = useCookClock(list.length > 0);
  const [dock, setDock] = useState<HeadDock>(DEFAULT_HEAD_DOCK);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const dragRef = useRef<Drag | null>(null);

  useEffect(() => {
    setDock(readDock());
    const size = () => setView({ w: window.innerWidth, h: window.innerHeight });
    size();
    window.addEventListener('resize', size);
    return () => window.removeEventListener('resize', size);
  }, []);

  // A card whose cook ended just stops showing (`open` below is null).
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId]);

  const stop = useCallback(
    (cook: RunningCook) => {
      cooks.finish(cook.session.id);
      toast(`Stopped cooking ${cook.recipe.title}`, {
        action: { label: 'Undo', onClick: () => cooks.restore(cook.session.id) },
      });
    },
    [cooks],
  );

  // Cook mode (R4) is the cook in full; the heads step aside there.
  if (!cooks.enabled || list.length === 0 || isCookModePath(pathname)) return null;

  const stacked = list.length >= HEADS_STACK_AT;
  const shown = stacked ? list.slice(0, 1) : list;
  const pileHeight = stacked ? HEAD_SIZE + 12 : list.length * HEAD_SIZE + (list.length - 1) * HEAD_GAP;
  const restLeft = dock.side === 'left' ? EDGE : view.w - HEAD_SIZE - EDGE;
  const restTop = Math.min(Math.max(56, dock.y * view.h - HEAD_SIZE / 2), Math.max(56, view.h - BOTTOM_INSET - pileHeight - 24));
  const dx = drag?.moved ? drag.dx : 0;
  const dy = drag?.moved ? drag.dy : 0;
  const draggedCenter = { x: restLeft + HEAD_SIZE / 2 + dx, y: restTop + HEAD_SIZE / 2 + dy };
  const overStop = !!drag?.moved && overStopTarget(draggedCenter.x, draggedCenter.y, view.w, view.h, BOTTOM_INSET);
  const target = stopTargetCenter(view.w, view.h, BOTTOM_INSET);

  const onPointerDown = (cookId: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const d = { pointerId: e.pointerId, cookId, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false };
    dragRef.current = d;
    setDrag(d);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const next = { ...d, dx: e.clientX - d.startX, dy: e.clientY - d.startY };
    next.moved = d.moved || Math.hypot(next.dx, next.dy) > 6;
    dragRef.current = next;
    setDrag(next);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d || d.pointerId !== e.pointerId) return;
    const cook = list.find((c) => c.session.id === d.cookId);
    if (!d.moved) {
      if (cook) setOpenId(cook.session.id);
      return;
    }
    const cx = restLeft + HEAD_SIZE / 2 + d.dx;
    const cy = restTop + HEAD_SIZE / 2 + d.dy;
    if (cook && overStopTarget(cx, cy, view.w, view.h, BOTTOM_INSET)) {
      stop(cook);
      return;
    }
    const next = snapHeadDock(cx, cy, view.w, view.h);
    setDock(next);
    saveDock(next);
  };

  const open = openId ? list.find((c) => c.session.id === openId) ?? null : null;

  return (
    <>
      {drag?.moved && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none fixed z-[60] flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed bg-background/80 text-muted-foreground transition-transform duration-[var(--motion-fast)]',
            overStop ? 'scale-110 border-destructive text-destructive' : 'border-border',
          )}
          style={{ left: target.x - 28, top: target.y - 28 }}
        >
          <X className="h-5 w-5" />
        </div>
      )}

      <div
        className="pointer-events-none fixed z-[61]"
        style={{
          left: restLeft,
          top: restTop,
          transform: `translate(${dx}px, ${dy}px)`,
          transition: drag?.moved ? 'none' : 'left var(--motion-settle) var(--motion-ease-out), top var(--motion-settle) var(--motion-ease-out)',
        }}
      >
        <div className="relative flex flex-col" style={{ gap: HEAD_GAP }}>
          {stacked &&
            [2, 1].map((n) => (
              <span
                key={n}
                aria-hidden
                data-hue="peach"
                className="absolute rounded-full border-2 border-background bg-[var(--hue-tile)] shadow-[0_6px_18px_rgb(0_0_0/0.35)]"
                style={{ width: HEAD_SIZE, height: HEAD_SIZE, top: n * 6, left: 0 }}
              />
            ))}
          {shown.map((cook) => (
            <Head
              key={cook.session.id}
              cook={cook}
              now={now}
              count={stacked ? list.length : undefined}
              dragging={drag?.cookId === cook.session.id && drag.moved}
              onPointerDown={onPointerDown(cook.session.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyOpen={() => setOpenId(cook.session.id)}
            />
          ))}
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[70] flex flex-col" role="dialog" aria-modal="true" aria-label={`Cooking ${open.recipe.title}`}>
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/30"
            onClick={() => setOpenId(null)}
          />
          {/* Only the heads and the card take clicks; the gaps close it like the scrim. */}
          <div className="pointer-events-none relative mx-auto flex w-full max-w-md flex-col gap-4 px-3 pt-6 [&>*]:pointer-events-auto">
            <div className="flex justify-end gap-3.5 px-1">
              {list.map((cook) => (
                <button
                  key={cook.session.id}
                  type="button"
                  onClick={() => setOpenId(cook.session.id)}
                  aria-label={cook.recipe.title}
                  aria-pressed={cook.session.id === open.session.id}
                  className={cn(
                    'rounded-full',
                    cook.session.id === open.session.id && 'outline outline-[3px] outline-offset-2 outline-primary',
                  )}
                >
                  <HeadFace cook={cook} now={now} size={52} />
                </button>
              ))}
            </div>
            <CookCard
              cook={open}
              cooks={cooks}
              now={now}
              onOpen={() => {
                setOpenId(null);
                router.push(`/recipes/${open.recipe.id}`);
              }}
              onStop={() => {
                setOpenId(null);
                stop(open);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

function Head({
  cook,
  now,
  count,
  dragging,
  onKeyOpen,
  ...pointer
}: {
  cook: RunningCook;
  now: number;
  /** In a pile: how many cooks it holds. */
  count?: number;
  dragging: boolean;
  onKeyOpen: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
}) {
  const badge = cookBadge(cook.session, cook.steps.length, now);
  const label = `${cook.recipe.title}, ${badge.tone === 'step' ? `step ${badge.text}` : `timer ${badge.text}`}${count ? `, ${count} recipes cooking` : ''}`;
  return (
    <button
      type="button"
      aria-label={label}
      {...pointer}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onKeyOpen();
        }
      }}
      className={cn(
        'pointer-events-auto relative touch-none select-none rounded-full transition-transform duration-[var(--motion-fast)]',
        dragging && 'scale-105 cursor-grabbing',
      )}
    >
      <HeadFace cook={cook} now={now} size={HEAD_SIZE} />
      {count && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 font-mono text-[11px] font-semibold text-background tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
}

function HeadFace({ cook, now, size }: { cook: RunningCook; now: number; size: number }) {
  const badge = cookBadge(cook.session, cook.steps.length, now);
  const near = nearestTimer(cook.session, now);
  const r = 29;
  const c = 2 * Math.PI * r;
  const p = near ? (near.state === 'done' ? 1 : timerProgress(near.timer, now)) : 0;
  const ring = !near ? null : near.state === 'done' ? 'stroke-destructive' : near.state === 'paused' ? 'stroke-muted-foreground' : near.remainingMs < 60_000 ? 'stroke-warning' : 'stroke-primary';
  return (
    <span
      data-hue="peach"
      className="relative flex items-center justify-center rounded-full border-2 border-background bg-[var(--hue-tile)] font-heading text-lg font-bold text-[var(--hue-glyph)] shadow-[0_6px_18px_rgb(0_0_0/0.35)]"
      style={{ width: size, height: size }}
    >
      {ring && (
        <svg viewBox="0 0 62 62" className="pointer-events-none absolute -inset-1" style={{ width: size + 8, height: size + 8 }} aria-hidden>
          <circle
            cx="31"
            cy="31"
            r={r}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - p)}
            transform="rotate(-90 31 31)"
            className={ring}
          />
        </svg>
      )}
      {cookInitials(cook.recipe.title)}
      <span
        className={cn(
          'absolute -bottom-2 left-1/2 flex h-5 -translate-x-1/2 items-center whitespace-nowrap rounded-full border border-border bg-card px-1.5 font-mono text-[11px] font-semibold tabular-nums',
          badge.tone === 'done' ? 'text-destructive' : badge.tone === 'step' || badge.tone === 'paused' ? 'text-muted-foreground' : near && near.remainingMs < 60_000 ? 'text-warning' : 'text-foreground',
        )}
      >
        {badge.tone === 'done' ? 'Done' : badge.text}
      </span>
    </span>
  );
}
