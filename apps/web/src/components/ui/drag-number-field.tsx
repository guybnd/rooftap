"use client";

// FLUX-182: a numeric field you can DRAG to adjust (left/right = ∓/±step) OR tap
// to type an exact value. Used for quantity, price, amount, shelf-life, reminder
// days and est. cost across the redesigned item modals.
//
// Interaction model:
//   - Press + drag horizontally → value changes by `step` every DRAG_PX pixels
//     (touch-action: pan-y keeps vertical scrolling of the sheet working).
//   - Press + release without moving (a tap/click) → enter edit mode: an input
//     appears focused with its contents selected; type a value, Enter/blur commits,
//     Escape cancels.
//   - Value is clamped to [min, max] and rounded to `precision` decimals.
//   - `allowEmpty` lets the field hold null (shown as the placeholder) when the
//     user clears it in edit mode.

import * as React from "react";
import { MoveHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface DragNumberFieldProps {
  value: number | null;
  onChange: (value: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Decimal places for display + rounding. Default 0. */
  precision?: number;
  /** Drop trailing ".00"/"0" in the display (for counts/weights that may be
   *  fractional but usually aren't) while still allowing `precision` decimals. */
  trimTrailingZeros?: boolean;
  /** Leading affix, e.g. "$". */
  prefix?: string;
  /** Trailing affix, e.g. "kg" or "days". */
  suffix?: string;
  placeholder?: string;
  /** When true, an empty edit commits `null` instead of 0. Default true. */
  allowEmpty?: boolean;
  ariaLabel?: string;
  className?: string;
  id?: string;
}

/** Pixels of horizontal drag per one `step` of change. */
const DRAG_PX = 10;

function clampRound(n: number, min: number, max: number, precision: number): number {
  const clamped = Math.min(max, Math.max(min, n));
  const factor = Math.pow(10, precision);
  return Math.round(clamped * factor) / factor;
}

function format(value: number, precision: number, trim = false): string {
  if (precision <= 0) return String(value);
  const fixed = value.toFixed(precision);
  return trim ? String(parseFloat(fixed)) : fixed;
}

export function DragNumberField({
  value,
  onChange,
  step = 1,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  precision = 0,
  trimTrailingZeros = false,
  prefix,
  suffix,
  placeholder = "–",
  allowEmpty = true,
  ariaLabel,
  className,
  id,
}: DragNumberFieldProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Drag bookkeeping (refs so the pointer handlers stay stable).
  const dragState = React.useRef<{
    pointerId: number;
    startX: number;
    startValue: number;
    moved: boolean;
  } | null>(null);

  const commitDraft = React.useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      onChange(allowEmpty ? null : clampRound(0, min, max, precision));
    } else {
      const parsed = parseFloat(trimmed);
      if (Number.isFinite(parsed)) {
        onChange(clampRound(parsed, min, max, precision));
      }
      // Non-numeric input is discarded (value unchanged).
    }
    setEditing(false);
  }, [draft, allowEmpty, min, max, precision, onChange]);

  const enterEdit = React.useCallback(() => {
    setDraft(value != null ? format(value, precision, trimTrailingZeros) : "");
    setEditing(true);
  }, [value, precision, trimTrailingZeros]);

  // Focus + select once the edit input mounts.
  React.useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [editing]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return;
    // Only primary button / touch / pen.
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startValue: value ?? 0,
      moved: false,
    };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragState.current;
    if (!st || st.pointerId !== e.pointerId) return;
    const dx = e.clientX - st.startX;
    if (!st.moved && Math.abs(dx) < 4) return; // below tap threshold
    st.moved = true;
    const deltaSteps = Math.round(dx / DRAG_PX);
    const next = clampRound(st.startValue + deltaSteps * step, min, max, precision);
    if (next !== value) onChange(next);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragState.current;
    if (!st || st.pointerId !== e.pointerId) return;
    const el = e.currentTarget as HTMLDivElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    const wasTap = !st.moved;
    dragState.current = null;
    if (wasTap) enterEdit();
  };

  // A vertical scroll that started on the field hands the gesture to the browser
  // (touch-action: pan-y) and cancels the pointer — drop the drag without ever
  // treating it as a tap-to-edit.
  const onPointerCancel = () => {
    dragState.current = null;
  };

  const display = value != null ? `${prefix ?? ""}${format(value, precision, trimTrailingZeros)}${suffix ? ` ${suffix}` : ""}` : placeholder;

  if (editing) {
    return (
      <div
        className={cn(
          "flex h-9 items-center gap-1 rounded-lg border border-ring bg-background px-2.5 text-sm ring-3 ring-ring/50",
          className
        )}
      >
        {prefix && <span className="text-muted-foreground">{prefix}</span>}
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="decimal"
          value={draft}
          aria-label={ariaLabel}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder={placeholder}
        />
        {suffix && <span className="shrink-0 text-muted-foreground">{suffix}</span>}
      </div>
    );
  }

  return (
    <div
      id={id}
      role="spinbutton"
      aria-label={ariaLabel}
      aria-valuenow={value ?? undefined}
      aria-valuemin={min}
      aria-valuemax={max === Number.MAX_SAFE_INTEGER ? undefined : max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") {
          e.preventDefault();
          onChange(clampRound((value ?? 0) + step, min, max, precision));
        } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
          e.preventDefault();
          onChange(clampRound((value ?? 0) - step, min, max, precision));
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          enterEdit();
        }
      }}
      style={{ touchAction: "pan-y" }}
      className={cn(
        "flex h-9 cursor-ew-resize select-none items-center justify-between gap-1 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        value == null && "text-muted-foreground",
        className
      )}
    >
      <span className="truncate">{display}</span>
      <MoveHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
    </div>
  );
}
