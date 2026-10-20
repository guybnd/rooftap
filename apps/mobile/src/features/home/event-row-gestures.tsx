// The gestures on a household event's Home row: swipe right for directions
// (when it has a place), swipe left to hide it from Home, hold to edit it in
// place. Tapping the row itself still opens its day in the calendar.
import * as React from 'react';
import { Linking } from 'react-native';
import { EyeOff, Navigation } from 'lucide-react-native';
import { mapsDirectionsUrl, type GroupEvent } from '@homeup/core';
import { SwipeActions, useHoldFill, type SwipeConfig } from '@homeup/ui';

const LONG_PRESS_MS = 500;
const DIRECTIONS_CFG: SwipeConfig = {
  bg: 'bg-primary/15',
  activeBg: 'bg-primary',
  icon: <Navigation size={18} className="text-primary-foreground" />,
  label: 'Directions',
};
const HIDE_CFG: SwipeConfig = {
  bg: 'bg-muted-foreground/15',
  activeBg: 'bg-muted-foreground',
  icon: <EyeOff size={18} className="text-background" />,
  label: 'Hide',
};

export function EventRowGestures({
  event,
  onEdit,
  onHide,
  children,
}: {
  event: GroupEvent;
  onEdit: () => void;
  onHide: () => void;
  /** The row, given the hold fill's progress for its ListItem. */
  children: (holdProgress: number) => React.ReactNode;
}) {
  const holdFill = useHoldFill(LONG_PRESS_MS);
  const place = event.location?.trim();
  return (
    <SwipeActions
      onSwipeRight={place ? () => void Linking.openURL(mapsDirectionsUrl(place, event.travel_mode)) : undefined}
      right={place ? DIRECTIONS_CFG : undefined}
      onSwipeLeft={onHide}
      left={HIDE_CFG}
      onLongPress={onEdit}
      onHoldStart={holdFill.start}
      onHoldEnd={holdFill.stop}
    >
      {children(holdFill.progress)}
    </SwipeActions>
  );
}
