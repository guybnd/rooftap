"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { commit } from "@/lib/haptics"

export interface UsePressableOptions {
  /** Fires on a completed press that did not escalate into a long-press. */
  onPress?: () => void
  /** Fires once the pointer has been held for `longPressMs`. Omit to disable long-press entirely. */
  onLongPress?: () => void
  /** Hold duration before `onLongPress` fires. */
  longPressMs?: number
  disabled?: boolean
  /**
   * Attempt a short `navigator.vibrate` pulse when the long-press fires.
   * Progressive enhancement only (Android/Chrome) — the press-scale animation
   * is the guaranteed feedback across all platforms.
   */
  haptics?: boolean
}

export interface PressableProps {
  "data-pressed": "" | undefined
  onPointerDown: (event: React.PointerEvent) => void
  onPointerMove: (event: React.PointerEvent) => void
  onPointerUp: (event: React.PointerEvent) => void
  onPointerLeave: (event: React.PointerEvent) => void
  onPointerCancel: (event: React.PointerEvent) => void
  onClickCapture: (event: React.MouseEvent) => void
  onKeyDown: (event: React.KeyboardEvent) => void
}

export interface UsePressableResult {
  pressed: boolean
  longPressing: boolean
  /** Spread onto the pressable element. */
  pressableProps: PressableProps
}

/**
 * Movement tolerance before an active press is cancelled. Roughly matches
 * platform tap-slop conventions (~10px): within it a press survives normal
 * finger jitter; beyond it the gesture is a drag, not a press.
 */
const MOVE_SLOP_PX = 10

/**
 * Press-scale + long-press interaction primitive shared by row/list-item
 * affordances. This hook only ever provides the *visual* feedback and the
 * long-press timer — a long-press-gated action must still be reachable via a
 * visible, focusable trigger (e.g. an overflow button), since there is no
 * keyboard equivalent for "hold" gestures.
 *
 * Pair the returned `pressableProps` with `PRESSABLE_SCALE_CLASSNAME` (or an
 * equivalent `data-[pressed]:motion-safe:scale-*` rule) to get a
 * reduced-motion-safe press animation. Focus outlines are untouched by this
 * hook — do not add `outline-none` alongside it.
 *
 * Keyboard: Enter/Space trigger `onPress` on non-natively-interactive targets
 * only. On native `button`/`a`/form controls the browser's own activation
 * (keydown → click) is authoritative — wire `onPress` behavior through the
 * element's `onClick` there instead, or the two paths would double-fire.
 */
export function usePressable(options: UsePressableOptions = {}): UsePressableResult {
  const { onPress, onLongPress, longPressMs = 500, disabled = false, haptics = true } = options

  const [pressed, setPressed] = useState(false)
  const [longPressing, setLongPressing] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firedLongPress = useRef(false)
  const activePointerId = useRef<number | null>(null)
  const startCoords = useRef<{ x: number; y: number } | null>(null)
  // A long-press consumed the gesture: the browser's synthetic click after
  // touchend must be swallowed or it ghost-clicks whatever the long-press
  // opened (and on `asChild` links, navigates on top of the long-press action).
  const suppressClick = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Long-press timer must not outlive the component (e.g. row unmounted mid-hold).
  useEffect(() => clearTimer, [clearTimer])

  const reset = useCallback(() => {
    clearTimer()
    setPressed(false)
    setLongPressing(false)
    firedLongPress.current = false
    activePointerId.current = null
    startCoords.current = null
  }, [clearTimer])

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return
      if (event.pointerType === "mouse" && event.button !== 0) return

      activePointerId.current = event.pointerId
      firedLongPress.current = false
      // Any suppressed click has fired (or been dropped) by the time a new
      // pointer goes down — never let a stale flag eat the next plain tap.
      suppressClick.current = false
      startCoords.current = { x: event.clientX, y: event.clientY }
      setPressed(true)

      if (onLongPress) {
        timerRef.current = setTimeout(() => {
          firedLongPress.current = true
          suppressClick.current = true
          setLongPressing(true)
          if (haptics) commit()
          onLongPress()
        }, longPressMs)
      }
    },
    [disabled, haptics, longPressMs, onLongPress]
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (activePointerId.current !== event.pointerId) return
      const wasLongPress = firedLongPress.current
      reset()
      if (!wasLongPress) onPress?.()
    },
    [onPress, reset]
  )

  // Move-slop cancel. Touch pointers get implicit pointer capture on
  // pointerdown, so `pointerleave` never fires while a finger is down — the
  // move threshold is the only reliable "dragged away" signal on touch. It
  // also stops the long-press timer from firing mid-slow-drag.
  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (activePointerId.current !== event.pointerId) return
      const start = startCoords.current
      if (!start) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (dx * dx + dy * dy > MOVE_SLOP_PX * MOVE_SLOP_PX) {
        reset()
      }
    },
    [reset]
  )

  // Kept alongside the move threshold for mouse parity: mouse pointers are
  // not implicitly captured, so `pointerleave` still fires and gives the
  // platform-conventional "drag off the control to cancel" even when the
  // cursor exits within the slop radius (press near an element edge).
  const onPointerLeave = useCallback(
    (event: React.PointerEvent) => {
      if (activePointerId.current !== event.pointerId) return
      reset()
    },
    [reset]
  )

  // Swallow the synthetic click that follows a long-press (capture phase, so
  // consumer handlers and `asChild` native targets never see it). A plain tap
  // never sets the flag, so native click — e.g. Link navigation — passes
  // through untouched.
  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (!suppressClick.current) return
    suppressClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }, [])

  // Keyboard activation for non-natively-interactive hosts (e.g. a `div` row).
  // Native buttons/links/form controls synthesize their own keydown → click
  // activation, so firing `onPress` there too would double-activate — those
  // hosts are skipped (see hook docstring).
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (disabled || !onPress) return
      if (event.key !== "Enter" && event.key !== " ") return
      if (event.defaultPrevented) return
      const tag = (event.target as HTMLElement).tagName
      if (
        tag === "BUTTON" ||
        tag === "A" ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT"
      ) {
        return
      }
      // Space scrolls the page by default; Enter is inert on a div.
      if (event.key === " ") event.preventDefault()
      onPress()
    },
    [disabled, onPress]
  )

  return {
    pressed,
    longPressing,
    pressableProps: {
      "data-pressed": pressed ? "" : undefined,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerLeave,
      onPointerCancel: onPointerLeave,
      onClickCapture,
      onKeyDown,
    },
  }
}

/**
 * Tailwind classes for the press-scale feedback. `motion-reduce:` drops the
 * transition entirely (no scale on state change) so `prefers-reduced-motion`
 * users never see the animation while everything else still functions.
 */
export const PRESSABLE_SCALE_CLASSNAME =
  "transition-transform duration-150 ease-out motion-reduce:transition-none data-[pressed]:motion-safe:scale-[0.97]"
