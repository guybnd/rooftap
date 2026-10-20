// A small menu that pops out of the control that opened it (household
// feedback: the calendar's "+" opened a bottom sheet, a long trip for the
// thumb). Native counterpart of web's anchored calendar chooser
// (apps/web/src/app/calendar/page.tsx). The caller measures its trigger
// with `measureInWindow` and passes that rect; the menu opens below it,
// right-aligned to it, and flips above when there's no room below.
import * as React from 'react';
import { Modal, Pressable, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { cn } from '../lib/cn';
import { select } from '../lib/haptics';
import { useThemeMaterial } from '../theme/theme-provider';

export interface ActionMenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ActionMenuItem {
  key: string;
  label: string;
  Icon?: React.ComponentType<{ size?: number; className?: string }>;
  onPress: () => void;
}

export interface ActionMenuProps {
  /** The trigger's window rect; null keeps the menu closed. */
  anchor: ActionMenuAnchor | null;
  onClose: () => void;
  items: ActionMenuItem[];
}

const MENU_WIDTH = 200;
const ITEM_HEIGHT = 44;
const GAP = 6;
const EDGE = 12;
// Hearth MO: fast (150ms) swift-out, same as BottomSheet's scrim.
const MOTION_FAST_MS = 150;
const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);

export function ActionMenu({ anchor, onClose, items }: ActionMenuProps) {
  const material = useThemeMaterial();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const progress = useSharedValue(0);

  React.useEffect(() => {
    progress.value = anchor ? withTiming(1, { duration: MOTION_FAST_MS, easing: SWIFT_OUT }) : 0;
  }, [anchor, progress]);

  const menuHeight = items.length * ITEM_HEIGHT;
  const below = anchor ? anchor.y + anchor.height + GAP : 0;
  const flip = anchor ? below + menuHeight > windowHeight - EDGE : false;
  const top = anchor ? (flip ? anchor.y - GAP - menuHeight : below) : 0;
  const left = anchor
    ? Math.min(Math.max(EDGE, anchor.x + anchor.width - MENU_WIDTH), windowWidth - MENU_WIDTH - EDGE)
    : 0;

  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * (flip ? 6 : -6) }, { scale: 0.96 + progress.value * 0.04 }],
  }));

  return (
    <Modal transparent visible={anchor != null} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Close menu" onPress={onClose} className="absolute inset-0" />
      <Animated.View
        accessibilityRole="menu"
        style={[
          menuStyle,
          { top, left, width: MENU_WIDTH, backgroundColor: material.glassBg, borderColor: material.glassBorder, boxShadow: material.cardShadow },
        ]}
        className="absolute overflow-hidden rounded-xl border"
      >
        {items.map((item, index) => (
          <Pressable
            key={item.key}
            accessibilityRole="menuitem"
            onPress={() => {
              select();
              item.onPress();
            }}
            style={{ height: ITEM_HEIGHT }}
            className={cn('flex-row items-center gap-2.5 px-3.5 active:bg-muted', index > 0 && 'border-t border-border/60')}
          >
            {item.Icon && <item.Icon size={16} className="text-muted-foreground" />}
            <Text className="text-body text-foreground">{item.label}</Text>
          </Pressable>
        ))}
      </Animated.View>
    </Modal>
  );
}
