'use client';

// Home's clock: the time now, refreshed on each minute boundary, so what
// depends on the time of day (an event that has just finished leaving the Now
// card) moves on while the screen stays open.

import { useEffect, useState } from 'react';

/** The current time, re-read at the start of every minute. */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const msToNextMinute = 60_000 - (Date.now() % 60_000);
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, msToNextMinute + 50);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return now;
}
