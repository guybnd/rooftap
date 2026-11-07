'use client';

// Voice input for the Assistant's composer on web: the browser's own speech
// recognition (Web Speech API: Chrome, Edge and Safari) as core's
// VoiceEngine, and the bar the composer turns into while it listens.
// Browsers without it never show the mic. The browser gives no input level,
// so the meter breathes on its own. Native twin: apps/mobile/src/features/assistant/voice-input.tsx.
import { type CSSProperties } from 'react';
import { ROOFTAP_SPECTRUM, type VoiceEngine, type VoiceInput } from '@homeup/core';

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface Recognition {
  interimResults: boolean;
  continuous: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onresult: ((e: { results: ArrayLike<RecognitionResult> }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

let engine: VoiceEngine | null = null;

/** The browser's recognizer, made once; unavailable where the browser has none. The browser gives no input level. */
export function browserVoiceEngine(): VoiceEngine {
  if (engine) return engine;
  const Ctor = recognitionCtor();
  if (!Ctor) return { available: false, requestPermission: async () => false, start: () => {}, stop: () => {}, abort: () => {} };
  let rec: Recognition | null = null;
  engine = {
    available: true,
    // The browser asks for the microphone itself when listening starts.
    requestPermission: async () => true,
    start: (h) => {
      rec = new Ctor();
      rec.interimResults = true;
      rec.continuous = false;
      rec.lang = navigator.language || 'en';
      rec.onstart = h.onStart;
      rec.onresult = (e) => {
        const results = Array.from(e.results);
        h.onText(results.map((r) => r[0].transcript).join(''), results.length > 0 && results.every((r) => r.isFinal));
      };
      rec.onerror = (e) => h.onError(e.error);
      rec.onend = () => {
        rec = null;
        h.onEnd();
      };
      rec.start();
    },
    stop: () => rec?.stop(),
    abort: () => rec?.abort(),
  };
  return engine;
}

/** The composer while listening: a meter in the roof's colours, the words so far, and a stop square. */
export function ListeningBar({ voice }: { voice: VoiceInput }) {
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-3xl border border-border/60 bg-card py-1.5 pl-4 pr-1.5" aria-live="polite">
      <div className="flex h-7 items-center gap-[3px]" aria-hidden>
        {ROOFTAP_SPECTRUM.map((c, i) => (
          <span key={c} className="voice-bar w-[3px] rounded-sm" style={{ backgroundColor: c, '--bar-delay': `${i * -130}ms` } as CSSProperties} />
        ))}
      </div>
      <p className={voice.transcript ? 'min-w-0 flex-1 text-[15px] text-foreground' : 'min-w-0 flex-1 text-[15px] text-muted-foreground'}>{voice.transcript || 'Listening'}</p>
      <button
        type="button"
        onClick={voice.finish}
        onContextMenu={(e) => {
          e.preventDefault();
          voice.cancel();
        }}
        aria-label="Stop listening and send"
        title="Stop and send. Right-click to cancel."
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground"
      >
        <span className="size-3 rounded-[3px] bg-background" />
      </button>
    </div>
  );
}
