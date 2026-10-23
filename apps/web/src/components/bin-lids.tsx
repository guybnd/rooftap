// Bin night: the small lid marks. Lid colours are content (the real bins),
// so they only ever paint these marks, never text, tiles or buttons.
// Native twin: apps/mobile/src/features/bins/bin-lids.tsx.
import { binLidColor, type BinLid } from '@homeup/core';
import { cn } from '@/lib/utils';

export function BinLidMark({ lid, size = 'md', className }: { lid: BinLid | string; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0 border border-foreground/25',
        size === 'sm' ? 'h-1.5 w-3 rounded-[2px]' : 'size-3.5 rounded',
        className
      )}
      style={{ backgroundColor: binLidColor(lid as BinLid) }}
    />
  );
}

export function BinLids({ lids, size = 'md', stacked = false, className }: { lids: readonly string[]; size?: 'sm' | 'md'; stacked?: boolean; className?: string }) {
  if (lids.length === 0) return null;
  return (
    <span className={cn('inline-flex shrink-0 gap-1', stacked && 'flex-col gap-[3px]', className)}>
      {lids.map((lid, i) => (
        <BinLidMark key={`${lid}-${i}`} lid={lid} size={size} />
      ))}
    </span>
  );
}
