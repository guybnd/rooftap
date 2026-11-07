'use client';

// Voice input for the Assistant's composer, the same on both platforms: a
// tap on the mic listens, the words show as they are heard, and the ask
// sends when the person stops talking or taps stop. Each app hands in its
// platform's recognizer as a VoiceEngine (the phone's expo-speech-recognition,
// the browser's Web Speech API); this hook keeps the state and decides when
// to send. An engine that cannot listen hides the mic.
import { useCallback, useEffect, useRef, useState } from 'react';
import { voiceErrorText } from './assistant-view';

export interface VoiceHandlers {
  onStart: () => void;
  /** The words heard so far for this ask; `final` once the recognizer is sure. */
  onText: (text: string, final: boolean) => void;
  /** Input level, 0 to 1, where the platform reports one. */
  onLevel: (level: number) => void;
  /** A Web Speech error code ('not-allowed', 'no-speech' and so on). */
  onError: (code: string) => void;
  /** Always last, after an error too. */
  onEnd: () => void;
}

export interface VoiceEngine {
  available: boolean;
  /** Asks for the microphone if needed; false when the person refused. */
  requestPermission: () => Promise<boolean>;
  start: (handlers: VoiceHandlers) => void;
  /** Stop listening and keep what was heard. */
  stop: () => void;
  /** Stop listening and drop it. */
  abort: () => void;
}

export interface VoiceInput {
  available: boolean;
  listening: boolean;
  transcript: string;
  level: number;
  start: () => Promise<void>;
  finish: () => void;
  cancel: () => void;
}

export function useVoiceInput(
  engine: VoiceEngine,
  onHeard: (text: string) => void,
  options: { onListening?: (on: boolean) => void; onError?: (message: string) => void; onTick?: () => void } = {}
): VoiceInput {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [level, setLevel] = useState(0);
  const heardRef = useRef(onHeard);
  heardRef.current = onHeard;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const textRef = useRef('');
  // Set once the ask is sent or dropped, so the end of the session sends nothing more.
  const doneRef = useRef(false);
  const activeRef = useRef(false);

  useEffect(() => () => {
    if (activeRef.current) engine.abort();
  }, [engine]);

  const send = useCallback(() => {
    const text = textRef.current.trim();
    if (doneRef.current || !text) return;
    doneRef.current = true;
    heardRef.current(text);
  }, []);

  const start = useCallback(async () => {
    if (!engine.available || activeRef.current) return;
    if (!(await engine.requestPermission())) {
      optionsRef.current.onError?.(voiceErrorText('not-allowed') ?? '');
      return;
    }
    optionsRef.current.onTick?.();
    textRef.current = '';
    doneRef.current = false;
    activeRef.current = true;
    setTranscript('');
    engine.start({
      onStart: () => {
        setListening(true);
        optionsRef.current.onListening?.(true);
      },
      onText: (text, final) => {
        textRef.current = text;
        setTranscript(text);
        if (final) send();
      },
      onLevel: setLevel,
      onError: (code) => {
        const message = voiceErrorText(code);
        if (message) optionsRef.current.onError?.(message);
      },
      onEnd: () => {
        // A recognizer that ends without a final result still sends what it heard.
        send();
        activeRef.current = false;
        optionsRef.current.onTick?.();
        setListening(false);
        setLevel(0);
        setTranscript('');
        optionsRef.current.onListening?.(false);
      },
    });
  }, [engine, send]);

  const finish = useCallback(() => engine.stop(), [engine]);
  const cancel = useCallback(() => {
    doneRef.current = true;
    engine.abort();
  }, [engine]);

  return { available: engine.available, listening, transcript, level, start, finish, cancel };
}
