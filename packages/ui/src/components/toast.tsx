// HOUP-139: universal toast/undo host. Mobile has had no toast layer at all
// (web ports either stayed silent or used blocking `Alert.alert`) — this is
// the single primitive both platforms could eventually share (web may keep
// `sonner` for now; see the store's header comment). Bottom-anchored, stacked
// above app chrome via `bottomOffset`, auto-dismissing, with an optional
// action slot for Undo/Edit. A toast can opt into a top-anchored stack
// (placement: 'top') for app-level notices such as OTA updates.
//
// Motion: Hearth MO's "slow" token family (300ms in / 250ms ease-in out) —
// same `FadeIn`/`FadeOut` convention `list-item.tsx` already uses, just at
// the sheet-weight durations instead of list-item's quick 200/150. Haptics
// per HA: `success()` on a success toast, `error()` on an error toast —
// layered on the visible card, never the only signal.
import * as React from 'react';
import { AccessibilityInfo, Platform, Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle2, XCircle } from 'lucide-react-native';
import { error as errorHaptic, success as successHaptic, tick as tickHaptic } from '../lib/haptics';
import { dismissToast, getToasts, subscribeToasts, type ToastEntry } from '../lib/toast-store';

const ENTER_MS = 300;
const EXIT_MS = 250;

export interface ToastHostProps {
  /** Extra clearance above the host's own safe-area inset, e.g. a tab bar's height. Default 0. */
  bottomOffset?: number;
}

/** Mount once near the app root (see apps/mobile/src/app/_layout.tsx). */
export function ToastHost({ bottomOffset = 0 }: ToastHostProps) {
  const toasts = React.useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  const top = toasts.filter((t) => t.placement === 'top');
  const bottom = toasts.filter((t) => t.placement !== 'top');

  return (
    <>
      {top.length > 0 && (
        <View
          pointerEvents="box-none"
          className="absolute inset-x-0 z-50 items-center px-4"
          style={{ top: insets.top + 12 }}
        >
          {top.map((entry) => (
            <ToastCard key={entry.id} entry={entry} />
          ))}
        </View>
      )}
      {bottom.length > 0 && (
        <View
          pointerEvents="box-none"
          className="absolute inset-x-0 z-50 items-center px-4"
          style={{ bottom: insets.bottom + bottomOffset + 12 }}
        >
          {bottom.map((entry) => (
            <ToastCard key={entry.id} entry={entry} />
          ))}
        </View>
      )}
    </>
  );
}

function ToastCard({ entry }: { entry: ToastEntry }) {
  const closed = React.useRef(false);

  const close = React.useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    dismissToast(entry.id);
  }, [entry.id]);

  React.useEffect(() => {
    if (entry.variant === 'success') successHaptic();
    else if (entry.variant === 'error') errorHaptic();
    if (Platform.OS === 'ios') {
      const announcement = entry.description ? `${entry.message}. ${entry.description}` : entry.message;
      AccessibilityInfo.announceForAccessibility(announcement);
    }
    const timer = setTimeout(close, entry.duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      entering={FadeIn.duration(ENTER_MS)}
      exiting={FadeOut.duration(EXIT_MS)}
      accessibilityLiveRegion="polite"
      className="mb-2 w-full max-w-md flex-row items-center gap-3 rounded-xl border border-border/60 bg-popover px-4 py-3 shadow-md"
    >
      {entry.variant === 'success' && <CheckCircle2 size={18} className="shrink-0 text-success" />}
      {entry.variant === 'error' && <XCircle size={18} className="shrink-0 text-destructive" />}
      <View className="min-w-0 flex-1 gap-0.5">
        <Text numberOfLines={2} className="text-sm font-medium text-popover-foreground">
          {entry.message}
        </Text>
        {entry.description && (
          <Text numberOfLines={2} className="text-caption text-muted-foreground">
            {entry.description}
          </Text>
        )}
      </View>
      {entry.action && (
        <Pressable
          onPress={() => {
            tickHaptic();
            entry.action!.onPress();
            close();
          }}
          hitSlop={8}
          accessibilityRole="button"
          className="shrink-0"
        >
          <Text className="text-sm font-semibold text-primary">{entry.action.label}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}
