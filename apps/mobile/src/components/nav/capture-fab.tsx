// HOUP-68: native port of apps/web/src/components/capture/capture-buttons.tsx's
// `MobileCaptureFab` (Hearth M1: "the tab bar's raised capture '+' anchors the
// thumb zone"). A tap opens the capture sheet. With `onAsk` (assistant on),
// holding it fans out into Add and Ask over a dimmed screen, so the assistant
// is one hold away from every screen. Web twin: MobileCaptureFab's AskFan.
import * as React from 'react';
import { Modal, Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { Plus, Sparkles } from 'lucide-react-native';
import { MOTION_DURATIONS_MS, sectionHueSwatch } from '@homeup/core';
import { Text, cn, haptics, useThemeMaterial } from '@homeup/ui';

// Same hold as the tab bar's slot picker (primary-tab-bar.tsx).
const ASK_HOLD_MS = 450;

export interface CaptureFabProps {
  onPress?: () => void;
  /** A reply waiting unread: the + wears a small dot in the assistant's glow. */
  unread?: boolean;
  /** Offered on a hold; leave out to make the + tap-only. */
  onAsk?: () => void;
  className?: string;
}

export function CaptureFab({ onPress, onAsk, unread, className }: CaptureFabProps) {
  const [fanOpen, setFanOpen] = React.useState(false);
  const { scheme } = useThemeMaterial();
  return (
    <>
      <Pressable
        onPress={onPress}
        onLongPress={
          onAsk
            ? () => {
                haptics.commit();
                setFanOpen(true);
              }
            : undefined
        }
        delayLongPress={ASK_HOLD_MS}
        accessibilityRole="button"
        accessibilityLabel={unread ? 'Add, new answer waiting' : 'Add'}
        accessibilityHint={onAsk ? 'Hold to ask Rooftap' : undefined}
        accessibilityActions={onAsk ? [{ name: 'longpress', label: 'Ask Rooftap' }] : undefined}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && onAsk?.()}
        className={cn(
          'absolute -top-5 left-1/2 z-30 h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full bg-primary shadow-lg active:scale-95',
          className
        )}
      >
        <Plus size={24} className="text-primary-foreground" />
        {unread && (
          <View
            pointerEvents="none"
            className="absolute right-0 top-0 size-3.5 rounded-full border-2 border-background"
            style={{ backgroundColor: sectionHueSwatch('assistant', scheme).glow }}
          />
        )}
      </Pressable>
      {onAsk && (
        <AskFan
          open={fanOpen}
          onClose={() => setFanOpen(false)}
          onAdd={() => {
            setFanOpen(false);
            onPress?.();
          }}
          onAsk={() => {
            setFanOpen(false);
            haptics.select();
            onAsk();
          }}
        />
      )}
    </>
  );
}

function AskFan({ open, onClose, onAdd, onAsk }: { open: boolean; onClose: () => void; onAdd: () => void; onAsk: () => void }) {
  const { scheme } = useThemeMaterial();
  const still = useReducedMotion();
  const hue = sectionHueSwatch('assistant', scheme);
  const enter = (delay: number) =>
    still ? undefined : FadeInDown.duration(MOTION_DURATIONS_MS.base).delay(delay);
  return (
    <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View entering={still ? undefined : FadeIn.duration(MOTION_DURATIONS_MS.base)} className="flex-1">
        <Pressable onPress={onClose} accessibilityLabel="Close" className="absolute inset-0 bg-black/60" />
        <View pointerEvents="box-none" className="absolute inset-x-0 bottom-32 flex-row justify-center gap-20">
          <Animated.View entering={enter(0)}>
            <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel="Add" className="items-center gap-2">
              <View className="h-16 w-16 items-center justify-center rounded-full border border-border bg-card">
                <Plus size={28} className="text-foreground" />
              </View>
              <Text className="text-sm font-medium text-foreground">Add</Text>
            </Pressable>
          </Animated.View>
          <Animated.View entering={enter(40)}>
            <Pressable onPress={onAsk} accessibilityRole="button" accessibilityLabel="Ask Rooftap" className="items-center gap-2">
              <View
                className="h-16 w-16 items-center justify-center rounded-full border-2"
                style={{ backgroundColor: hue.tile, borderColor: hue.glow }}
              >
                <Sparkles size={28} color={hue.glyph} />
              </View>
              <Text className="text-sm font-medium" style={{ color: hue.glyph }}>
                Ask
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}
