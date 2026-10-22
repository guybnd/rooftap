'use client';

// Hearth v2 (Pulse): the Now card — web twin of packages/ui's NowCard.
// Home's one "do this next" item under the Hero lede: its section tile, a
// Display title, one meta line and, for anything that can be finished, the
// slide-to-finish track. Clicking the card body opens the item (M3's tap
// path); only the slide finishes it. Key it by the item id.
//
// NowCardPager is how Home shows it (web twin of packages/ui's): the next
// few things in order (core pickNowQueue), one card at a time. On touch,
// swipe sideways on the card's top (tile, title and meta) to look ahead or
// back; the slide track below keeps its own drag and never turns the page,
// and a vertical drag stays the page's scroll. The chevrons beside the page
// dots turn it with a click or a tap (M3's visible path). Finishing a card
// celebrates on it (SlideToComplete's burst), then the card leaves and the
// next one arrives in its place; the item is only marked done once it has
// left, so the finish lands with the card's exit.
//
// A card with a `body` (a dated checklist's items) opens in place instead:
// clicking its top shows the body inside the card, clicking again folds it,
// and turning the page folds it too. `progress` gives such a card its own
// segmented meter under the meta line (H3: the meter sits with its list).

import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { MOTION_DURATIONS_MS, MOTION_EASE, nowQueueIndex } from "@homeup/core";
import { cn } from "@/lib/utils";
import { SegmentMeter } from "./hero-lede";
import { LeadingTile } from "./leading-tile";
import { prefersReducedMotion, SlideToComplete } from "./slide-to-complete";

const EYEBROW_TONE = {
  muted: "text-muted-foreground",
  warning: "text-warning",
  danger: "text-destructive",
} as const;

export interface NowCardProps {
  sectionId: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  eyebrow: string;
  eyebrowTone?: keyof typeof EYEBROW_TONE;
  title: string;
  meta?: ReactNode;
  /** The item's own progress (a checklist's items), drawn as a segmented meter under the meta. */
  progress?: { done: number; total: number } | null;
  /**
   * What the card shows when it's open (a checklist's items). With a body,
   * clicking the card's top opens and folds it instead of calling `onOpen`.
   */
  body?: ReactNode;
  onOpen?: () => void;
  onComplete?: () => void;
  /**
   * What sits at the card's foot when it can't be finished (an event's place,
   * end time and actions), where a to-do has its slide track.
   */
  footer?: ReactNode;
  /**
   * How a finishable card is finished: the slide track (touch), or a round
   * check beside the title where a slide feels out of place (a desktop
   * pointer, Hearth §13 "Desktop shell").
   */
  finishAs?: "slide" | "button";
  className?: string;
}

export function NowCard(props: NowCardProps) {
  const [expanded, setExpanded] = useState(false);
  return <NowCardFrame {...props} expanded={expanded} onToggleExpanded={() => setExpanded((open) => !open)} />;
}

function NowCardFrame({
  sectionId,
  Icon,
  eyebrow,
  eyebrowTone = "muted",
  title,
  meta,
  progress,
  body,
  onOpen,
  onComplete,
  footer,
  finishAs = "slide",
  className,
  headProps,
  hidden,
  expanded = false,
  onToggleExpanded,
}: NowCardProps & {
  /** The pager's swipe handlers, on the card's top only (never the slide track). */
  headProps?: HTMLAttributes<HTMLDivElement>;
  /** An off-screen page: out of the tab order and the accessibility tree. */
  hidden?: boolean;
  /** Whether the body shows; only a card with a body opens. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const opensInPlace = body != null && !!onToggleExpanded;
  // Desktop (Hearth §13.7): finishing is a round check beside the title, the
  // same tick a task row has, grown to the card's scale. It fills success on
  // hover so the colour arrives with intent, never as a resting accent.
  const tick =
    onComplete && finishAs === "button" ? (
      <button
        type="button"
        onClick={onComplete}
        aria-label="Mark done"
        title="Mark done"
        className="group/tick grid size-11 shrink-0 place-items-center rounded-full border-2 border-muted-foreground/40 text-transparent transition-[border-color,background-color,color,scale] duration-[var(--motion-fast)] hover:border-success hover:bg-success/15 hover:text-success focus-visible:border-success focus-visible:text-success focus-visible:outline-none active:scale-[0.92]"
      >
        <Check className="size-5" strokeWidth={2.5} />
      </button>
    ) : null;
  const head = (
    <>
      <LeadingTile sectionId={sectionId} Icon={Icon} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className={cn("text-[10.5px] font-semibold uppercase tracking-[0.1em]", EYEBROW_TONE[eyebrowTone])}>{eyebrow}</span>
        <span className="line-clamp-2 font-heading text-2xl font-bold leading-tight tracking-[-0.02em] text-foreground">{title}</span>
      </span>
    </>
  );
  return (
    <section
      aria-label="Up next"
      inert={hidden || undefined}
      className={cn("flex flex-col gap-4 rounded-3xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)] md:p-5", className)}
    >
      <div {...headProps} className={cn("flex flex-col gap-2", headProps?.className)}>
        <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
        {opensInPlace ? (
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            className="flex items-center gap-3 rounded-xl text-left transition-opacity hover:opacity-90"
          >
            {head}
            <ChevronDown
              aria-hidden
              className={cn(
                "size-5 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-fast)] ease-[var(--motion-ease-out)]",
                expanded && "rotate-180"
              )}
            />
          </button>
        ) : onOpen ? (
          <button type="button" onClick={onOpen} className="flex items-center gap-3 rounded-xl text-left transition-opacity hover:opacity-90">
            {head}
          </button>
        ) : (
          <div className="flex items-center gap-3">{head}</div>
        )}
        </div>
        {tick}
        </div>
        {meta != null && <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[54px]">{meta}</div>}
        {progress && progress.total > 0 && (
          <div className="flex items-center gap-2.5 pl-[54px]">
            <SegmentMeter done={progress.done} total={progress.total} tone="success" className="flex-1" />
            <span className="font-mono text-xs font-medium tabular-nums text-muted-foreground">
              {progress.done} of {progress.total}
            </span>
          </div>
        )}
      </div>
      {opensInPlace && expanded && <div>{body}</div>}
      {/* mt-auto: in the pager every card is as tall as the tallest, and the
          track stays at the bottom edge where the thumb expects it. */}
      {onComplete && finishAs !== "button" && <SlideToComplete onComplete={onComplete} className="mt-auto md:max-w-md" />}
      {!onComplete && footer != null && <div className="mt-auto">{footer}</div>}
    </section>
  );
}

export interface NowCardPagerItem extends Omit<NowCardProps, "className"> {
  /** The item's id: pages are keyed by it and the pager stays on it as the queue changes. */
  id: string;
}

/** Space between pages; wider than the clip margin below so a neighbour never peeks at rest. */
const PAGE_GAP = 24;
/** A release past this share of a page (or a quick flick) turns it. */
const TURN_AT = 0.22;
const FLICK_MS = 250;
const FLICK_PX = 30;
/** How far a touch travels before it counts as a sideways swipe or the page's scroll. */
const INTENT_PX = 10;
/** Drag resistance past the first and last page. */
const EDGE_RESIST = 0.25;
/** The finished card's beat: the thumb lands (base), the burst plays (slow), a breath (fast). */
const CELEBRATE_MS = MOTION_DURATIONS_MS.base + MOTION_DURATIONS_MS.slow + MOTION_DURATIONS_MS.fast;
/** How far the finished card drifts as it leaves, and the next one as it arrives. */
const SHIFT_PX = 16;
/** If the finished item hasn't left the queue by then, bring the card back anyway. */
const ARRIVE_FALLBACK_MS = 400;

type Swipe = { pointerId: number; x: number; y: number; t: number; dragging: boolean };

export function NowCardPager({
  items,
  className,
  finishAs,
}: {
  items: NowCardPagerItem[];
  className?: string;
  finishAs?: NowCardProps["finishAs"];
}) {
  // Which item the person paged to (null follows the head) and where it was,
  // so the card holds its place when that item leaves the queue.
  const [anchor, setAnchor] = useState<{ id: string | null; index: number }>({ id: null, index: 0 });
  // The item whose slide just finished, while it celebrates and leaves.
  const [celebratingId, setCelebratingId] = useState<string | null>(null);
  // The card opened in place (its body showing). Turning the page folds it.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Live drag offset in px while a swipe is under the finger.
  const [drag, setDrag] = useState<number | null>(null);
  // Whether the strip glides to its page (a turn) or jumps (layout, queue changes).
  const [glide, setGlide] = useState(false);
  const ids = items.map((item) => item.id);
  const idsKey = ids.join("|");
  const count = items.length;
  const index = nowQueueIndex(ids, celebratingId ?? anchor.id, anchor.index);

  const viewportRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<Swipe | null>(null);
  const swallowClick = useRef(false);
  // One stable box for the timers and the finish still owed, so unmount can flush it.
  const run = useRef<{ timers: ReturnType<typeof setTimeout>[]; owed: NowCardPagerItem | null; leftId: string | null }>({
    timers: [],
    owed: null,
    leftId: null,
  });

  const goTo = (target: number) => {
    if (target < 0 || target >= count || target === index) return;
    setExpandedId(null);
    setGlide(true);
    setAnchor({ id: target === 0 ? null : ids[target], index: target });
  };

  // The next card arrives where the finished one left: drift in and fade up.
  const arrive = useCallback(() => {
    if (run.current.leftId === null) return;
    run.current.leftId = null;
    const wrapper = wrapperRef.current;
    if (!wrapper?.animate) return;
    wrapper.getAnimations().forEach((a) => a.cancel());
    if (prefersReducedMotion()) return;
    wrapper.animate([{ opacity: 0, transform: `translateX(${SHIFT_PX}px)` }, { opacity: 1, transform: "none" }], {
      duration: MOTION_DURATIONS_MS.slow,
      easing: MOTION_EASE.out,
    });
  }, []);

  // Once the finished item is out of the queue, the strip has re-laid itself
  // out behind the faded card and the next one can arrive.
  useEffect(() => {
    const leftId = run.current.leftId;
    if (leftId !== null && !idsKey.split("|").includes(leftId)) arrive();
  }, [idsKey, arrive]);

  const celebrate = (item: NowCardPagerItem, at: number) => {
    run.current.owed = item;
    setCelebratingId(item.id);
    setAnchor({ id: at === 0 ? null : item.id, index: at });
    const reduced = prefersReducedMotion();
    const leaveMs = reduced ? 0 : MOTION_DURATIONS_MS.exit;
    run.current.timers.push(
      setTimeout(() => {
        if (reduced) return;
        wrapperRef.current?.animate?.([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(-${SHIFT_PX}px)` }], {
          duration: leaveMs,
          easing: MOTION_EASE.in,
          fill: "forwards",
        });
      }, CELEBRATE_MS),
      setTimeout(() => {
        const owed = run.current.owed;
        run.current.owed = null;
        if (!owed) return;
        run.current.leftId = owed.id;
        setCelebratingId(null);
        owed.onComplete?.();
        run.current.timers.push(setTimeout(arrive, ARRIVE_FALLBACK_MS));
      }, CELEBRATE_MS + leaveMs)
    );
  };

  // Leaving mid-celebration still finishes the item.
  useEffect(() => {
    const box = run.current;
    return () => {
      box.timers.forEach(clearTimeout);
      const owed = box.owed;
      box.owed = null;
      owed?.onComplete?.();
    };
  }, []);

  // ── Touch swipe on the card's top. Mouse uses the chevrons; the head's
  // touch-action leaves vertical pans to the browser, which cancels the
  // pointer once it scrolls. ─────────────────────────────────────────────────
  const swipeEnabled = count > 1 && celebratingId === null;
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!swipeEnabled || e.pointerType === "mouse" || !e.isPrimary) return;
    swipe.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, dragging: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.dragging) {
      if (Math.abs(dy) > INTENT_PX && Math.abs(dy) >= Math.abs(dx)) {
        swipe.current = null; // a vertical drag: the page's scroll
        return;
      }
      if (Math.abs(dx) < INTENT_PX) return;
      s.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setGlide(false);
    }
    const resisted = (index === 0 && dx > 0) || (index === count - 1 && dx < 0) ? dx * EDGE_RESIST : dx;
    setDrag(resisted);
  };
  const endSwipe = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const s = swipe.current;
    if (!s || s.pointerId !== e.pointerId) return;
    swipe.current = null;
    if (!s.dragging) return;
    // The click that follows a drag isn't a tap on the card.
    swallowClick.current = true;
    setTimeout(() => {
      swallowClick.current = false;
    }, 0);
    const dx = e.clientX - s.x;
    const width = viewportRef.current?.clientWidth ?? 0;
    const flick = e.timeStamp - s.t < FLICK_MS && Math.abs(dx) > FLICK_PX;
    let target = index;
    if (!cancelled && (dx < -width * TURN_AT || (flick && dx < 0)) && index < count - 1) target = index + 1;
    else if (!cancelled && (dx > width * TURN_AT || (flick && dx > 0)) && index > 0) target = index - 1;
    setGlide(true);
    setDrag(null);
    if (target === index) return;
    setExpandedId(null);
    setAnchor({ id: target === 0 ? null : ids[target], index: target });
  };
  const headProps: HTMLAttributes<HTMLDivElement> = {
    className: "touch-pan-y",
    onPointerDown,
    onPointerMove,
    onPointerUp: (e) => endSwipe(e, false),
    onPointerCancel: (e) => endSwipe(e, true),
    onClickCapture: (e) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };

  if (count === 0) return null;

  const openId = expandedId !== null && expandedId === ids[index] ? expandedId : null;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* The clip reaches a gutter past the card so its shadow isn't cut;
          PAGE_GAP is wider, so the neighbours stay out of sight at rest. */}
      <div ref={viewportRef} className="-mx-4 -my-4 overflow-hidden px-4 py-4">
        <div ref={wrapperRef}>
          <div
            className={cn(
              // An open card grows alone; its neighbours keep their own height.
              "flex",
              openId ? "items-start" : "items-stretch",
              glide && drag === null && "transition-transform duration-[var(--motion-base)] ease-[var(--motion-ease-out)]"
            )}
            style={{ gap: PAGE_GAP, transform: `translateX(calc(${-index} * (100% + ${PAGE_GAP}px) + ${drag ?? 0}px))` }}
            onTransitionEnd={(e) => {
              if (e.target === e.currentTarget) setGlide(false);
            }}
          >
            {items.map((item, at) => (
              <div key={item.id} className="flex w-full shrink-0">
                <NowCardFrame
                  sectionId={item.sectionId}
                  Icon={item.Icon}
                  eyebrow={item.eyebrow}
                  eyebrowTone={item.eyebrowTone}
                  title={item.title}
                  meta={item.meta}
                  progress={item.progress}
                  body={item.body}
                  expanded={openId === item.id}
                  onToggleExpanded={
                    celebratingId !== null ? undefined : () => setExpandedId((open) => (open === item.id ? null : item.id))
                  }
                  onOpen={celebratingId !== null ? undefined : item.onOpen}
                  onComplete={item.onComplete ? () => celebrate(item, at) : undefined}
                  footer={item.footer}
                  finishAs={finishAs}
                  headProps={at === index ? headProps : undefined}
                  hidden={at !== index}
                  className="w-full"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      {count > 1 && (
        <div className="flex items-center justify-center gap-2" aria-label="Up next" role="group">
          <PagerButton label="Previous item" disabled={celebratingId !== null || index === 0} onClick={() => goTo(index - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </PagerButton>
          <div className="flex items-center gap-1.5 px-1" role="status" aria-label={`${index + 1} of ${count}`}>
            {items.map((item, at) => (
              <span key={item.id} className={cn("size-1.5 rounded-full", at === index ? "bg-foreground/70" : "bg-foreground/20")} />
            ))}
          </div>
          <PagerButton label="Next item" disabled={celebratingId !== null || index === count - 1} onClick={() => goTo(index + 1)}>
            <ChevronRight className="h-4 w-4" />
          </PagerButton>
        </div>
      )}
    </div>
  );
}

/** A quiet chevron: small to the eye, a full 44px to the finger (M2). */
function PagerButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="relative flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
