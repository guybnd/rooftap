"use client";

import { useEffect } from "react";

// After a deploy, a returning PWA client can still be running the previous
// build's HTML while the Service Worker precache has moved on. Next.js's router
// then tries to lazy-load a JS chunk by a hash that no longer exists on the new
// deploy → ChunkLoadError → Next's generic "Application error" screen. A single
// reload pulls the fresh shell + chunks, so we recover automatically instead of
// stranding the user on the error page.
//
// Guarded by sessionStorage + a timestamp so a genuinely persistent failure
// (not a stale-chunk case) can't loop-reload the page.

const RELOAD_KEY = "homeup_chunk_reloaded_at";
const RELOAD_COOLDOWN_MS = 10_000;

const CHUNK_ERROR_RE =
  /Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

function isChunkLoadError(value: unknown): boolean {
  if (!value) return false;
  const name = (value as { name?: string }).name;
  if (name === "ChunkLoadError") return true;
  const message = (value as { message?: string }).message;
  return typeof message === "string" && CHUNK_ERROR_RE.test(message);
}

function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return; // already reloaded recently — avoid a loop
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage unavailable (private mode): fall through to a single reload.
  }
  window.location.reload();
}

export function ChunkReload() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (isChunkLoadError(e.error) || isChunkLoadError(e)) reloadOnce();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkLoadError(e.reason)) reloadOnce();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // HOUP-127: proactive counterpart to the ChunkLoadError recovery above. The
  // SW (sw.ts skipWaiting+clientsClaim) activates and claims clients as soon
  // as a deploy ships, but an already-open tab keeps running the JS it already
  // loaded until it next navigates. Reload once when a NEW SW takes control —
  // "new" meaning this tab already had a controller before the change, so the
  // very first install (no prior controller) doesn't trigger a reload loop.
  // Dev unregisters the SW entirely (see layout.tsx), so this is a no-op there.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let hadController = Boolean(navigator.serviceWorker.controller);
    const onControllerChange = () => {
      if (hadController) reloadOnce();
      hadController = true;
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
