// Themed confirm/prompt dialog, replacing React Native's Alert.alert (Android
// draws it in the OS's own grey box with teal buttons, whatever the Hearth
// theme). Call sites ask through @homeup/core's `dialog` store
// (`dialog.alert(title, message, buttons)` keeps Alert.alert's shape;
// `dialog.confirm` / `dialog.prompt` return promises); this host renders the
// head of that queue. Mount once near the app root.
//
// Hearth M4: a center dialog is for destructive confirms (and the few
// questions that must block). E4/HA: `warn()` fires as a destructive confirm
// appears and `remove()` when its destructive button is pressed, so call
// sites fire neither. A destructive button wears the danger hue on a soft
// tint, never a fill; a plain confirm is the coral primary.
//
// Motion: Hearth MO fast (150ms) swift-out, the same scale-and-fade
// ActionMenu uses. The root is sized to the safe-area frame, not flex:1:
// Android lays out a Modal's first frame short (see bottom-sheet.tsx), which
// would make a centered card jump.
import * as React from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getDialogs,
  isDestructiveDialog,
  resolveDialog,
  subscribeDialogs,
  type DialogButton,
  type DialogEntry,
} from '@homeup/core';
import { cn } from '../lib/cn';
import { remove, select, warn } from '../lib/haptics';
import { useKeyboardOffset } from '../hooks/use-keyboard-offset';
import { useThemeMaterial } from '../theme/theme-provider';

const MOTION_FAST_MS = 150;
const SWIFT_OUT = Easing.bezier(0.16, 1, 0.3, 1);

/** Mount once near the app root (see apps/mobile/src/app/_layout.tsx). */
export function DialogHost() {
  const dialogs = React.useSyncExternalStore(subscribeDialogs, getDialogs, getDialogs);
  const entry = dialogs[0];
  if (!entry) return null;
  // Keyed so a queued dialog mounts fresh (its own field value, its own entrance).
  return <DialogCard key={entry.id} entry={entry} />;
}

function DialogCard({ entry }: { entry: DialogEntry }) {
  const material = useThemeMaterial();
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  const keyboardOffset = useKeyboardOffset(insets.bottom, entry.input != null);
  const progress = useSharedValue(0);
  const [value, setValue] = React.useState(entry.input?.defaultValue ?? '');

  React.useEffect(() => {
    if (isDestructiveDialog(entry)) warn();
    progress.value = withTiming(1, { duration: MOTION_FAST_MS, easing: SWIFT_OUT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  // A prompt rises by half the keyboard so the card stays centered in the space left above it.
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: -keyboardOffset.value / 2 }, { scale: 0.96 + progress.value * 0.04 }],
  }));

  const press = (button: DialogButton, index: number) => {
    if (button.style === 'destructive') remove();
    else if (button.style !== 'cancel') select();
    resolveDialog(entry.id, index, value);
  };
  const dismiss = () => resolveDialog(entry.id, null, value);
  const stacked = entry.buttons.length > 2;
  // The confirm-side button takes Return in a prompt.
  const submitIndex = entry.buttons.findIndex((b) => b.style !== 'cancel');

  return (
    <Modal transparent visible animationType="none" onRequestClose={dismiss} statusBarTranslucent navigationBarTranslucent>
      <View
        style={
          frame.height > 0
            ? { position: 'absolute', left: 0, top: 0, width: frame.width, height: frame.height }
            : { flex: 1 }
        }
        className="items-center justify-center px-6"
      >
        <Animated.View style={scrimStyle} className="absolute inset-0 bg-black/40">
          <Pressable accessibilityLabel="Close" onPress={dismiss} className="flex-1" />
        </Animated.View>
        <Animated.View
          accessibilityRole="alert"
          accessibilityViewIsModal
          style={[cardStyle, { backgroundColor: material.glassBg, borderColor: material.glassBorder, boxShadow: material.cardShadow }]}
          className="w-full max-w-sm gap-4 rounded-2xl border p-5"
        >
          <View className="gap-1.5">
            <Text className="font-heading text-title text-foreground">{entry.title}</Text>
            {entry.message ? <Text className="text-body text-muted-foreground">{entry.message}</Text> : null}
          </View>
          {entry.input && (
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder={entry.input.placeholder}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={() => {
                if (submitIndex >= 0) press(entry.buttons[submitIndex]!, submitIndex);
              }}
              className="h-11 rounded-lg border border-input bg-transparent px-3 text-body text-foreground placeholder:text-muted-foreground focus:border-ring"
            />
          )}
          <View className={stacked ? 'gap-2' : 'flex-row gap-2'}>
            {entry.buttons.map((button, index) => (
              <DialogAction
                key={`${index}-${button.text}`}
                button={button}
                stacked={stacked}
                onPress={() => press(button, index)}
              />
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function DialogAction({ button, stacked, onPress }: { button: DialogButton; stacked: boolean; onPress: () => void }) {
  const tone = button.style ?? 'default';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={cn(
        'h-11 items-center justify-center rounded-xl px-4',
        !stacked && 'flex-1',
        tone === 'cancel' && (stacked ? 'active:bg-muted' : 'bg-muted active:bg-muted/70'),
        tone === 'destructive' && 'bg-destructive/10 active:bg-destructive/20',
        // A list of choices stays quiet; coral marks the one confirm of a pair.
        tone === 'default' && (stacked ? 'bg-muted active:bg-muted/70' : 'bg-primary active:bg-primary/80')
      )}
    >
      <Text
        numberOfLines={1}
        className={cn(
          'text-body font-semibold',
          tone === 'cancel' && (stacked ? 'text-muted-foreground' : 'text-foreground'),
          tone === 'destructive' && 'text-destructive',
          tone === 'default' && (stacked ? 'text-foreground' : 'text-primary-foreground')
        )}
      >
        {button.text}
      </Text>
    </Pressable>
  );
}
