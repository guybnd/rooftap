// HOUP-240: timestamped marks for profiling the ~3s JS-thread page-swap delay.
// `console.error` (not `.log`) is what reaches logcat's `ReactNativeJS` tag in
// a release build per this ticket's own device testing. Gated behind
// EXPO_PUBLIC_PERF_TRACE so a normal release build never pays the cost or
// emits noise — set it only for a purpose-built profiling APK
// (`EXPO_PUBLIC_PERF_TRACE=1 npx expo prebuild ...`).
const ENABLED = process.env.EXPO_PUBLIC_PERF_TRACE === '1';

export function perfMark(label: string, detail?: string) {
  if (!ENABLED) return;
  const t = Math.round(performance.now());
  console.error(`[perf] ${t}ms ${label}${detail ? ` ${detail}` : ''}`);
}
