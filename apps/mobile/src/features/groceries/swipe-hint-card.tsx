// HOUP-173: first-run onboarding hint teaching the swipe-to-shop gesture
// (Hearth M3 — "gestures first, buttons as proof", but every gesture needs a
// visible, non-gesture-taught path). Swipe right toggles needed<->bought,
// swipe left toggles needed<->have (see grocery-item-card.tsx's
// SwipeActions config) — this card is the discovery surface for that.
// Dismissal persists across sessions via expo-secure-store, mirroring
// apps/mobile/src/app/(tabs)/tasks/index.tsx's move-in countdown dismissal
// (SecureStore.getItemAsync/setItemAsync with a keyed constant).
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Card, Text } from '@homeup/ui';
import * as SecureStore from 'expo-secure-store';
import { ArrowRightLeft, X } from 'lucide-react-native';

const SWIPE_HINT_DISMISSED_KEY = 'groceries_swipe_hint_dismissed';

export function SwipeHintCard() {
  // null = not yet loaded from storage (render nothing to avoid a flash of
  // the hint before we know it was already dismissed).
  const [dismissed, setDismissed] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(SWIPE_HINT_DISMISSED_KEY).then((stored) => {
      if (!cancelled) setDismissed(stored === '1');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    void SecureStore.setItemAsync(SWIPE_HINT_DISMISSED_KEY, '1');
    setDismissed(true);
  };

  if (dismissed !== false) return null;

  return (
    // Hearth v2 (H2/H4): a neutral card, matching web's hint. The colour
    // words name the swipe reveals (right = success, left = primary; see
    // grocery-item-card.tsx's SwipeActions config).
    <Card className="flex-row items-start gap-3 rounded-3xl px-4 py-3">
      <ArrowRightLeft size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-sm font-medium text-foreground">Swipe to shop</Text>
        <Text className="text-xs text-muted-foreground">
          Swipe a row <Text className="text-xs text-success">right for Got it</Text> to count it toward today's spend,
          or <Text className="text-xs text-primary">left for Have it</Text> if it's already at home. Tap a row to edit.
        </Text>
      </View>
      <Pressable
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={12}
        className="shrink-0 rounded-md p-1"
      >
        <X size={16} className="text-muted-foreground" />
      </Pressable>
    </Card>
  );
}
