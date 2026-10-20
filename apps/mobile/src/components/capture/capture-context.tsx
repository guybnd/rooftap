// HOUP-136: native port of apps/web/src/components/capture/capture-context.tsx's
// CaptureProvider/useCapture. Just open/close state — unlike web, this does NOT
// own an online flag: CaptureSheet reads useDataCache().isOnline directly, so
// there's no navigator.onLine equivalent to poll here.
import { createContext, useCallback, useContext, useState } from 'react';

interface CaptureContextValue {
  open: boolean;
  openCapture: () => void;
  closeCapture: () => void;
  setOpen: (open: boolean) => void;
}

const CaptureContext = createContext<CaptureContextValue>({
  open: false,
  openCapture: () => {},
  closeCapture: () => {},
  setOpen: () => {},
});

export function useCapture() {
  return useContext(CaptureContext);
}

export function CaptureProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  const openCapture = useCallback(() => setOpen(true), []);
  const closeCapture = useCallback(() => setOpen(false), []);

  return (
    <CaptureContext.Provider value={{ open, openCapture, closeCapture, setOpen }}>
      {children}
    </CaptureContext.Provider>
  );
}
