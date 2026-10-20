import { STATUS_FILL } from './setup-status';

interface SegmentedBarProps {
  counts: Record<string, number>;
  className?: string;
}

// A left-to-right progress meter (H3, ~3px): what's been bought fills from
// the left in the done hue, and the track carries what is still needed.
// Renders nothing when empty.
export function SegmentedBar({ counts, className = '' }: SegmentedBarProps) {
  const done = counts.installed ?? 0;
  const total = done + (counts.needed ?? 0);
  if (total === 0) return null;
  return (
    <div
      role="progressbar"
      aria-valuenow={done}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={`${done} of ${total} bought`}
      className={`flex h-[3px] overflow-hidden rounded-full ${STATUS_FILL.needed} ${className}`}
    >
      {done > 0 && (
        <div className={`h-full rounded-full ${STATUS_FILL.installed}`} style={{ width: `${(done / total) * 100}%` }} />
      )}
    </div>
  );
}
