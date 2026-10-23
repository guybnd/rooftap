'use client';

// Recipes v2 R2: web timers ring in the tab. A timer started in this browser
// rings here when it ends: a short chime, a browser notification when the
// tab is hidden (and permission is granted), and a toast. While any cook has
// a timer, the tab title counts down the nearest one. The tab must stay
// open; the phone app rings even when closed.

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  cookDeviceId,
  formatCountdown,
  nearestAcrossCooks,
  timerDoneText,
  timersToRing,
  useCookClock,
  useCooks,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';

function chime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    // Three soft rising beeps.
    [0, 0.35, 0.7].forEach((at, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 660 + i * 110;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.32);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    // No audio: the toast and the notification still show.
  }
}

/** Ask once, from a tap, so a hidden tab can still say a timer is done. */
export function askTimerNotificationPermission(): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  void Notification.requestPermission().catch(() => undefined);
}

export function CookAlarms() {
  const { group, currentUserId } = useDataCache();
  const cooks = useCooks(group?.id, currentUserId);
  const hasTimers = cooks.cooks.some((c) => c.session.timers.length > 0);
  const now = useCookClock(hasTimers);
  const rung = useRef(new Set<string>());

  // Ring the timers this browser started, at their end time.
  useEffect(() => {
    if (!cooks.enabled) return;
    const device = cookDeviceId();
    const handles: ReturnType<typeof setTimeout>[] = [];
    for (const { timer, session, endsAt } of timersToRing(cooks.cooks.map((c) => c.session), device)) {
      const key = `${timer.id}@${timer.endsAt}`;
      if (rung.current.has(key)) continue;
      const cook = cooks.cooks.find((c) => c.session.id === session.id);
      const fire = () => {
        if (rung.current.has(key)) return;
        rung.current.add(key);
        const { title, body } = timerDoneText(timer, cook?.recipe.title ?? 'Cooking');
        chime();
        toast(title, { description: body, duration: 10_000 });
        if (document.visibilityState !== 'visible' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            new Notification(title, { body, tag: `cook-timer-${timer.id}` });
          } catch {
            // Some browsers only allow notifications from a service worker.
          }
        }
      };
      const wait = endsAt - Date.now();
      // A timer that ended while the tab was closed for a long time stays quiet.
      if (wait <= 0) {
        if (wait > -60_000) fire();
        else rung.current.add(key);
        continue;
      }
      handles.push(setTimeout(fire, Math.min(wait, 2_147_000_000)));
    }
    return () => handles.forEach(clearTimeout);
  }, [cooks.enabled, cooks.cooks]);

  // The nearest timer in the tab title. A page change sets its own title,
  // which becomes the new base.
  const baseTitle = useRef<string | null>(null);
  const lastSet = useRef<string | null>(null);
  const near = cooks.enabled ? nearestAcrossCooks(cooks.cooks.map((c) => c.session), now) : null;
  const titleText = near ? `${near.state === 'done' ? 'Done' : formatCountdown(near.remainingMs)} ${near.timer.label}` : null;
  useEffect(() => {
    if (document.title !== lastSet.current) baseTitle.current = document.title;
    if (titleText) {
      lastSet.current = `${titleText} · ${baseTitle.current ?? ''}`;
      document.title = lastSet.current;
    } else if (lastSet.current !== null) {
      document.title = baseTitle.current ?? document.title;
      lastSet.current = null;
    }
  }, [titleText]);

  return null;
}
