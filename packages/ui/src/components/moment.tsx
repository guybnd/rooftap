// Hearth v2 (Pulse): a moment. A full-bleed coral screen for a real
// milestone only (today's last item finished), at most once a day, always
// dismissible with one tap or Back. The only place coral is a ground rather
// than an interactive colour. No confetti; the check scales in unless the
// person has asked for reduced motion.
import * as React from 'react';
import { AccessibilityInfo, Modal, Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { Check } from 'lucide-react-native';
import { MOTION_DURATIONS_MS } from '@homeup/core';

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = React.useState(false);
  React.useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return reduceMotion;
}

export interface MomentProps {
  open: boolean;
  onDismiss: () => void;
  title: string;
  caption?: string;
  /** An extra line under the caption, e.g. the all-clear streak. */
  detail?: string;
  /** The dismiss button's label. */
  actionLabel?: string;
}

export function Moment({ open, onDismiss, title, caption, detail, actionLabel = 'Nice' }: MomentProps) {
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible={open} onRequestClose={onDismiss} animationType="fade" statusBarTranslucent navigationBarTranslucent>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${caption ?? ''} Dismiss`}
        className="flex-1 justify-between bg-primary px-6 pb-14 pt-28"
      >
        <View className="gap-6">
          <Animated.View
            entering={reduceMotion ? undefined : ZoomIn.duration(MOTION_DURATIONS_MS.slow)}
            className="h-20 w-20 items-center justify-center rounded-full bg-primary-foreground/15"
          >
            <Check size={40} strokeWidth={2.6} className="text-primary-foreground" />
          </Animated.View>
          <Animated.View entering={reduceMotion ? undefined : FadeIn.delay(MOTION_DURATIONS_MS.fast)} className="gap-3">
            <Text className="text-hero-section text-primary-foreground">{title}</Text>
            {caption && <Text className="text-title text-primary-foreground/85">{caption}</Text>}
            {detail && <Text className="text-body text-primary-foreground/75">{detail}</Text>}
          </Animated.View>
        </View>
        <View className="h-14 items-center justify-center rounded-full bg-primary-foreground">
          <Text className="text-title text-primary">{actionLabel}</Text>
        </View>
      </Pressable>
    </Modal>
  );
}
