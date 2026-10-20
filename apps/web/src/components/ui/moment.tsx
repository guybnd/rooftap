'use client';

// Hearth v2 (Pulse): a moment — web twin of packages/ui's Moment. A
// full-bleed coral screen for a real milestone only (today's last item
// finished), at most once a day, dismissed by a click anywhere or Escape.
// The only place coral is a ground rather than an interactive colour. No
// confetti; the check scales in unless reduced motion is on (globals.css
// collapses the motion tokens to 0ms).

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

export function Moment({
  open,
  onDismiss,
  title,
  caption,
  detail,
  actionLabel = "Nice",
}: {
  open: boolean;
  onDismiss: () => void;
  title: string;
  caption?: string;
  detail?: string;
  actionLabel?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    buttonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="moment-title"
      onClick={onDismiss}
      className="fixed inset-0 z-[100] flex flex-col justify-between bg-primary px-6 pb-14 pt-28 text-primary-foreground animate-in fade-in duration-[var(--motion-slow)] md:items-center md:justify-center md:gap-16 md:p-10"
    >
      <div className="flex flex-col gap-6 md:items-center md:text-center">
        <span className="flex size-20 items-center justify-center rounded-full bg-primary-foreground/15 animate-in zoom-in-50 duration-[var(--motion-slow)]">
          <Check className="size-10" strokeWidth={2.6} />
        </span>
        <div className="flex flex-col gap-3">
          <h2 id="moment-title" className="text-hero-section">
            {title}
          </h2>
          {caption && <p className="font-heading text-base font-semibold opacity-85">{caption}</p>}
          {detail && <p className="text-sm opacity-75">{detail}</p>}
        </div>
      </div>
      <button
        ref={buttonRef}
        type="button"
        onClick={onDismiss}
        className="h-14 w-full rounded-full bg-primary-foreground font-heading text-base font-semibold text-primary md:w-80"
      >
        {actionLabel}
      </button>
    </div>,
    document.body
  );
}
