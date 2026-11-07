// Voice input for the Assistant's composer on the phone: the phone's own
// speech recognizer (expo-speech-recognition, Android SpeechRecognizer, on
// device where the phone offers it) as core's VoiceEngine, and the bar the
// composer turns into while it listens. Needs the native module, so on an
// app build from before it the mic stays hidden.
// Web twin: apps/web/src/app/assistant/voice-input.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ROOFTAP_SPECTRUM, voiceLevel, type VoiceEngine, type VoiceInput } from '@homeup/core';
import { Text, useStillMotion } from '@homeup/ui';

type SpeechModule = typeof import('expo-speech-recognition');

// Loaded lazily so a build without the native module never crashes on import.
function loadSpeech(): SpeechModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech-recognition') as SpeechModule;
    return mod.ExpoSpeechRecognitionModule?.isRecognitionAvailable?.() ? mod : null;
  } catch {
    return null;
  }
}

let engine: VoiceEngine | null = null;

/** The phone's recognizer, made once. */
export function phoneVoiceEngine(): VoiceEngine {
  if (engine) return engine;
  const mod = loadSpeech();
  if (!mod) {
    engine = { available: false, requestPermission: async () => false, start: () => {}, stop: () => {}, abort: () => {} };
    return engine;
  }
  const m = mod.ExpoSpeechRecognitionModule;
  let subs: { remove: () => void }[] = [];
  const clear = () => {
    subs.forEach((s) => s.remove());
    subs = [];
  };
  engine = {
    available: true,
    requestPermission: async () => (await m.requestPermissionsAsync()).granted,
    start: (h) => {
      clear();
      subs = [
        m.addListener('start', h.onStart),
        m.addListener('result', (e) => h.onText(e.results[0]?.transcript ?? '', e.isFinal)),
        m.addListener('volumechange', (e) => h.onLevel(voiceLevel(e.value))),
        m.addListener('error', (e) => h.onError(e.error)),
        m.addListener('end', () => {
          clear();
          h.onEnd();
        }),
      ];
      m.start({
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 90 },
        androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1500 },
      });
    },
    stop: () => m.stop(),
    abort: () => m.abort(),
  };
  return engine;
}

function Bar({ index, level, still }: { index: number; level: number; still: boolean }) {
  const h = useSharedValue(6);
  // Each bar answers the level a little differently, so the meter moves like a voice.
  const shape = [0.55, 0.85, 1, 0.75, 0.95, 0.6][index];
  React.useEffect(() => {
    const target = 6 + (still ? 0.4 : level) * 20 * shape;
    h.value = still ? target : withTiming(target, { duration: 90 });
  }, [level, still, shape, h]);
  const style = useAnimatedStyle(() => ({ height: h.value }));
  return <Animated.View style={[{ width: 3, borderRadius: 2, backgroundColor: ROOFTAP_SPECTRUM[index] }, style]} />;
}

/** The composer while listening: a level meter in the roof's colours, the words so far, and a stop square. */
export function ListeningBar({ voice }: { voice: VoiceInput }) {
  const still = useStillMotion();
  return (
    <View className="min-h-12 flex-row items-center gap-3 rounded-3xl border border-border/60 bg-card py-1.5 pl-4 pr-1.5" accessibilityLiveRegion="polite">
      <View className="h-7 flex-row items-center gap-[3px]" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {ROOFTAP_SPECTRUM.map((_, i) => (
          <Bar key={i} index={i} level={voice.level} still={still} />
        ))}
      </View>
      <Text numberOfLines={3} className={voice.transcript ? 'min-w-0 flex-1 text-body text-foreground' : 'min-w-0 flex-1 text-body text-muted-foreground'}>
        {voice.transcript || 'Listening'}
      </Text>
      <Pressable
        onPress={voice.finish}
        onLongPress={voice.cancel}
        accessibilityRole="button"
        accessibilityLabel="Stop listening and send"
        accessibilityHint="Hold to cancel"
        className="size-10 items-center justify-center rounded-full bg-foreground"
      >
        <View className="size-3 rounded-[3px] bg-background" />
      </Pressable>
    </View>
  );
}
