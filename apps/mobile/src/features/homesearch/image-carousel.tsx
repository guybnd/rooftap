// HOUP-78: native port of apps/web/src/components/image-carousel.tsx. Web's
// embla-carousel-react + pointer-down/up drag-vs-click disambiguation has no
// RN equivalent — `FlatList`'s `horizontal pagingEnabled` already treats a
// tap-without-drag correctly on its own, so that guard is dropped entirely.
// Prev/next chevron buttons are dropped per the ticket's native parity call
// (paging swipe + a dot/count indicator is sufficient parity); a single
// image renders with zero carousel chrome, matching web. Active index is
// tracked from `onMomentumScrollEnd` (RN's analogue of embla's `select`
// event) rather than continuous `onScroll`, since only the settled page
// matters for the dot indicator.
import * as React from 'react';
import {
  FlatList,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { cn } from '@homeup/ui';

export interface ImageCarouselProps {
  images: string[];
  alt?: string;
  className?: string;
}

export function ImageCarousel({ images, alt, className }: ImageCarouselProps) {
  const [width, setWidth] = React.useState(0);
  const [index, setIndex] = React.useState(0);

  const onLayout = React.useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth((prev) => (w > 0 && w !== prev ? w : prev));
  }, []);

  const onMomentumScrollEnd = React.useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!width) return;
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      setIndex(Math.max(0, Math.min(next, images.length - 1)));
    },
    [width, images.length]
  );

  if (images.length === 0) {
    return <View className={cn('h-full w-full bg-muted', className)} />;
  }

  if (images.length === 1) {
    return (
      <View className={cn('h-full w-full', className)}>
        <Image
          source={{ uri: images[0] }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          accessibilityLabel={alt}
        />
      </View>
    );
  }

  return (
    <View className={cn('relative h-full w-full', className)} onLayout={onLayout}>
      {width > 0 && (
        <FlatList
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(_, i) => String(i)}
          onMomentumScrollEnd={onMomentumScrollEnd}
          renderItem={({ item, index: i }) => (
            <View style={{ width, height: '100%' }}>
              <Image
                source={{ uri: item }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                accessibilityLabel={alt ? `${alt} - photo ${i + 1}` : undefined}
                priority={i === 0 ? 'high' : 'low'}
              />
            </View>
          )}
        />
      )}

      <View className="absolute bottom-2 left-0 right-0 flex-row items-center justify-center gap-1.5" pointerEvents="none">
        <Text
          className="rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {index + 1}/{images.length}
        </Text>
        <View className="flex-row gap-1">
          {images.slice(0, 5).map((_, i) => (
            <View key={i} className={cn('h-1.5 w-1.5 rounded-full', i === index ? 'bg-white' : 'bg-white/50')} />
          ))}
          {images.length > 5 && <View className="h-1.5 w-1.5 rounded-full bg-white/30" />}
        </View>
      </View>
    </View>
  );
}
