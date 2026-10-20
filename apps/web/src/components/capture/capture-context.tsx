"use client";

// FLUX-104: open/close state for the global capture sheet, plus a lightweight
// online flag. This provider wraps the whole app shell so the nav entry points
// (desktop "+ Capture", mobile raised "+") — which live OUTSIDE DataCacheProvider
// — can trigger the sheet. The sheet itself is mounted inside DataCacheProvider
// so it can read the active groupId.

import { createContext, useContext, useCallback, useEffect, useState } from "react";

interface CaptureContextValue {
  open: boolean;
  /** navigator.onLine, kept live — capture needs an upload, so we gate when offline. */
  isOnline: boolean;
  openCapture: () => void;
  closeCapture: () => void;
  setOpen: (open: boolean) => void;
}

const CaptureContext = createContext<CaptureContextValue>({
  open: false,
  isOnline: true,
  openCapture: () => {},
  closeCapture: () => {},
  setOpen: () => {},
});

export function useCapture() {
  return useContext(CaptureContext);
}

export function CaptureProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  const openCapture = useCallback(() => setOpen(true), []);
  const closeCapture = useCallback(() => setOpen(false), []);

  // Mirror the DataCache offline detection: events + a poll fallback (DevTools'
  // offline toggle doesn't always fire events).
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const interval = setInterval(() => setIsOnline(navigator.onLine), 3000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(interval);
    };
  }, []);

  return (
    <CaptureContext.Provider value={{ open, isOnline, openCapture, closeCapture, setOpen }}>
      {children}
    </CaptureContext.Provider>
  );
}
