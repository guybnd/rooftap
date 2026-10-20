'use client';

// Rewards cards: a card's barcode or QR drawn as one SVG path from
// @homeup/core's encoder (packages/ui's CardCode is the native twin). Always
// black on white whatever the theme: scanners read dark-on-light, and the
// white panel is content, not chrome.

import { useMemo } from 'react';
import { cardCodePath, encodeLoyaltyCard, type LoyaltyCardFormat } from '@homeup/core';
import { cn } from '@/lib/utils';

/** 1D codes draw this many modules tall before scaling, roughly a card's proportions. */
const LINEAR_HEIGHT_MODULES = 40;

export function CardCode({ number, format, className }: { number: string; format: LoyaltyCardFormat; className?: string }) {
  const path = useMemo(() => {
    const code = encodeLoyaltyCard(number, format);
    return code ? cardCodePath(code, LINEAR_HEIGHT_MODULES) : null;
  }, [number, format]);

  return (
    <div className={cn('flex w-full justify-center rounded-2xl bg-white p-3', className)}>
      {path ? (
        <svg
          role="img"
          aria-label={`${format === 'qr' ? 'QR code' : 'Barcode'} for ${number}`}
          viewBox={`0 0 ${path.width} ${path.height}`}
          preserveAspectRatio="none"
          shapeRendering="crispEdges"
          className={format === 'qr' ? 'aspect-square w-3/4 max-w-72' : 'w-full'}
          style={format === 'qr' ? undefined : { aspectRatio: `${path.width} / ${path.height}` }}
        >
          <rect width={path.width} height={path.height} fill="#ffffff" />
          <path d={path.d} fill="#000000" />
        </svg>
      ) : (
        <p className="py-6 text-center text-sm text-neutral-600">This number can&apos;t be drawn as a code</p>
      )}
    </div>
  );
}
