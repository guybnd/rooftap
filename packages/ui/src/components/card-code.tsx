// Rewards cards: draws a card's barcode or QR from @homeup/core's encoder as a
// single react-native-svg path, so no native barcode library is needed. The
// code always sits on white with black modules whatever the theme: scanners
// read dark-on-light, and the white panel is content, not chrome.
import * as React from 'react';
import { View, type ViewProps } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { cardCodePath, encodeLoyaltyCard, type LoyaltyCardFormat } from '@homeup/core';
import { cn } from '../lib/cn';
import { Text } from './text';

/** 1D codes draw this many modules tall before scaling, roughly a card's proportions. */
const LINEAR_HEIGHT_MODULES = 40;

export interface CardCodeProps extends ViewProps {
  number: string;
  format: LoyaltyCardFormat;
}

export function CardCode({ number, format, className, ...props }: CardCodeProps) {
  const path = React.useMemo(() => {
    const code = encodeLoyaltyCard(number, format);
    return code ? cardCodePath(code, LINEAR_HEIGHT_MODULES) : null;
  }, [number, format]);

  return (
    <View className={cn('w-full items-center rounded-2xl bg-white p-3', className)} {...props}>
      {path ? (
        <View
          className={format === 'qr' ? 'w-3/4' : 'w-full'}
          style={{ aspectRatio: path.width / path.height }}
          accessibilityRole="image"
          accessibilityLabel={`${format === 'qr' ? 'QR code' : 'Barcode'} for ${number}`}
        >
          <Svg width="100%" height="100%" viewBox={`0 0 ${path.width} ${path.height}`} preserveAspectRatio="none">
            <Rect x={0} y={0} width={path.width} height={path.height} fill="#ffffff" />
            <Path d={path.d} fill="#000000" />
          </Svg>
        </View>
      ) : (
        <Text className="py-6 text-center text-body text-neutral-600">This number can&apos;t be drawn as a code</Text>
      )}
    </View>
  );
}
