// HOUP-78: this is the map-surface placeholder boundary for the universal
// Apartments port. Web embeds two live Mapbox surfaces for a listing's
// location — ApartmentDetailMap (apps/web/src/components/apartment-detail-map.tsx,
// a full interactive map with nearby-POI markers on the detail page) and
// MiniMapPreview (apps/web/src/components/mini-map-preview.tsx, a static
// Mapbox Static-Images-API thumbnail used as the apartment card's image-area
// fallback and inline preview toggle). Neither surface is ported here: the
// real native map lands in the sibling ticket HOUP-109. This component is
// the intentional stand-in for both call sites — it renders a muted tile
// with a pin icon and the address (or coordinates), makes zero network
// calls, and imports no map SDK of any kind.
import * as React from 'react';
import { View } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { Text, cn } from '@homeup/ui';

interface MapPlaceholderTileProps {
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  variant?: 'card' | 'detail';
  className?: string;
}

export function MapPlaceholderTile({ address, lat, lng, variant = 'card', className }: MapPlaceholderTileProps) {
  const isDetail = variant === 'detail';

  const locationLabel =
    address ?? (lat != null && lng != null ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : null);

  return (
    <View
      className={cn(
        'items-center justify-center overflow-hidden bg-muted',
        isDetail ? 'h-56 rounded-xl gap-2 px-4' : 'h-40 rounded-md gap-1 px-2 aspect-[3/2]',
        className
      )}
    >
      <MapPin size={isDetail ? 28 : 20} className="text-muted-foreground" />
      {locationLabel && (
        <Text
          numberOfLines={isDetail ? 2 : 1}
          className={cn('text-center text-muted-foreground', isDetail ? 'text-body font-medium' : 'text-caption')}
        >
          {locationLabel}
        </Text>
      )}
      {isDetail && <Text className="text-caption text-muted-foreground">Map view coming soon</Text>}
    </View>
  );
}
