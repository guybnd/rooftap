'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

// FLUX-198: the ONE "loading into edit" hold-fill affordance (originally
// FLUX-180, inline-only in the Today hero). Grey bars sweep in from both ends
// and a pencil fades/scales in at centre as `progress` (from useLongPress's
// `trackProgress` option) ramps 0→1. Render this absolutely-positioned inside a
// `relative` row; give the row's real content `relative z-10` so it stays above.
//
// Hearth §8: the ramp itself stays untransitioned (it's already frame-accurate
// via useLongPress's rAF loop — adding a CSS transition on top would make it
// lag behind the real hold duration). An EARLY lift is different: useLongPress
// snaps `progress` straight to 0, which reads as a glitch rather than a release.
// Detect that drop-to-zero here and ease it back out at --motion-fast instead.
export function HoldFillOverlay({ progress }: { progress: number }) {
  const prevRef = useRef(progress);
  const [retreating, setRetreating] = useState(false);
  const retreatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = progress;
    if (progress === 0 && prev > 0) {
      setRetreating(true);
      if (retreatTimer.current) clearTimeout(retreatTimer.current);
      retreatTimer.current = setTimeout(() => setRetreating(false), 150); // mirrors --motion-fast
    } else if (progress > 0) {
      setRetreating(false);
    }
  }, [progress]);

  useEffect(() => () => { if (retreatTimer.current) clearTimeout(retreatTimer.current); }, []);

  const retreatTransition = retreating
    ? 'transition-[width,opacity,transform] duration-[var(--motion-fast)] ease-[var(--motion-ease-out)]'
    : '';

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
      <div className={cn('absolute inset-y-0 left-0 bg-muted-foreground/25', retreatTransition)} style={{ width: `${progress * 50}%` }} />
      <div className={cn('absolute inset-y-0 right-0 bg-muted-foreground/25', retreatTransition)} style={{ width: `${progress * 50}%` }} />
      <div
        className={cn('absolute inset-0 flex items-center justify-center', retreatTransition || 'transition-transform')}
        style={{ opacity: progress, transform: `scale(${0.6 + progress * 0.4})` }}
      >
        <Pencil className="h-4 w-4 text-foreground" />
      </div>
    </div>
  );
}
