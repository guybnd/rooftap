// Voice input for the Assistant's composer on the phone: the phone's own
// speech recognizer (expo-speech-recognition, Android SpeechRecognizer, on
// device where the phone offers it) as core's VoiceEngine, and the bar the
// composer turns into while it listens. On Android 13 and later it listens
// through pauses and joins the phrases (core voiceSegments). Needs the native module, so on an
// app build from before it the mic stays hidden.
// Web twin: apps/web/src/app/assistant/voice-input.tsx.
import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import {
  ROOFTAP_SPECTRUM,
  VOICE_FIRST_WORDS_MS,
  VOICE_MAX_MS,
  VOICE_PAUSE_MS,
  voiceLevel,
  voiceSegments,
  type VoiceEngine,
  type VoiceInput,
} from '@homeup/core';
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

// Android 13 and later can listen through pauses (a segmented session). Older
// phones stop at the recognizer's own pause, which can cut an ask short.
const SEGMENTED = Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 33;

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
  let timers: ReturnType<typeof setTimeout>[] = [];
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
  const clear = () => {
    subs.forEach((s) => s.remove());
    subs = [];
    clearTimers();
  };
  // Ends the session keeping every word: by now each phrase has its final
  // text, and the hook sends what it heard when the session ends.
  const end = () => {
    clearTimers();
    m.abort();
  };
  engine = {
    available: true,
    requestPermission: async () => (await m.requestPermissionsAsync()).granted,
    start: (h) => {
      clear();
      const words = voiceSegments();
      let heard = false;
      subs = [
        m.addListener('start', h.onStart),
        m.addListener('result', (e) => {
          const text = e.results[0]?.transcript ?? '';
          if (!SEGMENTED) {
            h.onText(text, e.isFinal);
            return;
          }
          // Phrases arrive one by one; the ask ends after a pause past a
          // finished phrase (or a tap on stop), never at the first pause.
          heard = heard || !!text.trim();
          h.onText(words.add(text, e.isFinal), false);
          clearTimers();
          later(VOICE_MAX_MS, end);
          if (e.isFinal) later(VOICE_PAUSE_MS, end);
        }),
        m.addListener('volumechange', (e) => h.onLevel(voiceLevel(e.value))),
        m.addListener('error', (e) => h.onError(e.error)),
        m.addListener('end', () => {
          clear();
          h.onEnd();
        }),
      ];
      if (SEGMENTED) later(VOICE_FIRST_WORDS_MS, () => !heard && end());
      m.start({
        interimResults: true,
        continuous: SEGMENTED,
        addsPunctuation: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 90 },
        androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 2000 },
      });
    },
    // Stop keeps the phrase being spoken: the recognizer finishes it first.
    // A session that does not end on its own soon after is ended here.
    stop: () => {
      m.stop();
      later(1500, end);
    },
    abort: () => {
      clear();
      m.abort();
    },
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
