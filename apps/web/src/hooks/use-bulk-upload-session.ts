"use client";

import { useState, useCallback, useEffect, useRef } from "react";

type UrlStatus = "queued" | "parsing" | "saving" | "done" | "failed";

interface UrlEntry {
  url: string;
  status: UrlStatus;
  address?: string;
  thumbnail?: string;
  apartmentId?: string;
  error?: string;
}

interface StoredSession {
  entries: UrlEntry[];
  startedAt: string;
  completedAt?: string;
}

const STORAGE_KEY = "bulk-upload-session";
const EXPIRY_MS = 24 * 60 * 60 * 1000;

function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session: StoredSession = JSON.parse(raw);
    if (Date.now() - new Date(session.startedAt).getTime() > EXPIRY_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function markInterrupted(entries: UrlEntry[]): UrlEntry[] {
  return entries.map((e) =>
    e.status === "queued" || e.status === "parsing" || e.status === "saving"
      ? { ...e, status: "failed" as const, error: "Interrupted: page was closed" }
      : e
  );
}

export function useBulkUploadSession() {
  const [entries, setEntriesRaw] = useState<UrlEntry[]>([]);
  const [restored, setRestored] = useState(false);
  const sessionRef = useRef<StoredSession | null>(null);

  useEffect(() => {
    const session = loadSession();
    if (session && session.entries.length > 0) {
      const fixed =
        session.startedAt && !session.completedAt
          ? markInterrupted(session.entries)
          : session.entries;
      setEntriesRaw(fixed);
      sessionRef.current = { ...session, entries: fixed };
      setRestored(true);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...session, entries: fixed }));
    }
  }, []);

  const setEntries = useCallback(
    (updater: UrlEntry[] | ((prev: UrlEntry[]) => UrlEntry[])) => {
      setEntriesRaw((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (sessionRef.current) {
          sessionRef.current.entries = next;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionRef.current));
        }
        return next;
      });
    },
    []
  );

  const startSession = useCallback((initial: UrlEntry[]) => {
    const session: StoredSession = {
      entries: initial,
      startedAt: new Date().toISOString(),
    };
    sessionRef.current = session;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setEntriesRaw(initial);
    setRestored(false);
  }, []);

  const completeSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.completedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionRef.current));
    }
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    sessionRef.current = null;
    setEntriesRaw([]);
    setRestored(false);
  }, []);

  return { entries, setEntries, restored, startSession, completeSession, clearSession };
}
