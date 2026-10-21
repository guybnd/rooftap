'use client';

// Rewards: a card drawn in its scheme's colour. The colour is content (like a
// grocery glyph), never chrome, so it stays inside the face. Native twin:
// apps/mobile/src/features/rewards/card-face.tsx.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** The wallet face: scheme name, who holds it, and one line of facts. */
export function CardFace({
  color,
  title,
  holder,
  detail,
  onClick,
}: {
  color: string;
  title: string;
  holder: string;
  detail?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ backgroundColor: color }}
      className="flex min-h-[88px] w-full flex-col justify-between gap-3 rounded-[20px] p-4 text-left text-white shadow-[0_-4px_14px_rgb(0_0_0/0.25)] outline-none transition-transform focus-visible:ring-3 focus-visible:ring-ring/60 active:scale-[0.99]"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="font-heading text-base font-bold leading-tight">{title}</span>
        <span className="shrink-0 text-xs font-medium text-white/85">{holder}</span>
      </span>
      {detail && <span className="truncate text-xs font-medium text-white/85">{detail}</span>}
    </button>
  );
}

/** The small face in a row's leading slot. */
export function MiniFace({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: color }}
      className={cn('relative block h-6 w-9 shrink-0 rounded-md', className)}
    >
      <span className="absolute bottom-1.5 left-1.5 h-[3px] w-3 rounded-sm bg-white/70" />
    </span>
  );
}
