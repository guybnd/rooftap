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

// Watches the JS thread for `ms` after a tab tap: a frame callback that comes
// late means JS was busy (rendering, effects, store work) and couldn't start
// or feed the slide. Logs the longest gap and how many gaps passed 50ms.
export function perfWatchJs(label: string, ms = 1500) {
  if (!ENABLED) return;
  const start = performance.now();
  let last = start;
  let longest = 0;
  let stalls = 0;
  let busy = 0;
  const tick = () => {
    const now = performance.now();
    const gap = now - last;
    if (gap > longest) longest = gap;
    if (gap > 50) stalls++;
    if (gap > 17) busy += gap - 16.7;
    last = now;
    if (now - start < ms) requestAnimationFrame(tick);
    else
      console.error(
        `[perf] ${Math.round(now)}ms js-watch ${label} longest=${Math.round(longest)} stalls50=${stalls} busy=${Math.round(busy)}`
      );
  };
  requestAnimationFrame(tick);
}
