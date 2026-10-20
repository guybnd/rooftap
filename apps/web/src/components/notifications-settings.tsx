"use client";

import { useState, useEffect, useCallback } from "react";
import { SettingsInset, SettingsPanel, SettingsSwitchRow } from "@/components/settings-panel";
import { Bell, Smartphone } from "lucide-react";
import { useDataCache } from "@/lib/data-cache";
import { OfflineHint } from "@/components/offline-hint";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { createClient } from "@/lib/supabase/client";
import { LEAVE_ALERT_OPTIONS, leaveAlertMinutes, useModules } from "@homeup/core";

/**
 * FLUX-128: opt-in to Web Push task notifications. The toggle drives the browser
 * permission prompt + PushManager subscription, then persists/removes the
 * subscription via /api/push/subscribe. iOS only delivers web push to a PWA added
 * to the Home Screen (iOS 16.4+), so in iOS Safari (non-standalone) we surface a
 * hint and disable the toggle rather than letting it silently fail.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

// A real VAPID public key is a base64url-encoded uncompressed P-256 point —
// 87 characters, unpadded. The .env.example placeholder ("your-vapid-public-key")
// is truthy, so a bare "is it set" check passes it straight through to atob(),
// which throws a raw InvalidCharacterError at the user. Shape-check first so
// an unconfigured instance gets the friendly message instead.
function isPlausibleVapidKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{80,}$/.test(key);
}

// VAPID public keys are base64url; PushManager.subscribe needs a BufferSource.
// Allocate an explicit ArrayBuffer so the type is Uint8Array<ArrayBuffer>.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

type Support =
  | { state: "checking" }
  | { state: "unsupported" }
  | { state: "ios-needs-install" }
  | { state: "no-active-worker" }
  | { state: "ready" };

// navigator.serviceWorker.ready never rejects — it just pends forever when no SW
// is active (always true in dev, src/app/layout.tsx:71-77 unregisters them there).
// Race it against a bounded timeout so the panel can't hang in "checking" forever.
const SW_READY_TIMEOUT_MS = 3000;

export function NotificationsSettings() {
  const { isOnline } = useDataCache();
  const [support, setSupport] = useState<Support>({ state: "checking" });
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve platform support + current subscription state on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hasSW = "serviceWorker" in navigator;
      const hasPush = "PushManager" in window;
      const hasNotif = "Notification" in window;

      const ua = navigator.userAgent || "";
      const isIOS = /iPad|iPhone|iPod/.test(ua) ||
        // iPadOS reports as Mac; detect via touch.
        (ua.includes("Macintosh") && "ontouchend" in document);
      const isStandalone =
        window.matchMedia?.("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;

      if (isIOS && !isStandalone) {
        if (!cancelled) setSupport({ state: "ios-needs-install" });
        return;
      }
      if (!hasSW || !hasPush || !hasNotif) {
        if (!cancelled) setSupport({ state: "unsupported" });
        return;
      }

      try {
        const timeout = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS)
        );
        const reg = await Promise.race([navigator.serviceWorker.ready, timeout]);
        if (!reg) {
          if (!cancelled) setSupport({ state: "no-active-worker" });
          return;
        }
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) {
          setEnabled(!!sub && Notification.permission === "granted");
          setSupport({ state: "ready" });
        }
      } catch {
        if (!cancelled) setSupport({ state: "ready" });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const enable = useCallback(async () => {
    setError(null);
    if (!isOnline) return;
    if (!VAPID_PUBLIC_KEY || !isPlausibleVapidKey(VAPID_PUBLIC_KEY)) {
      setError("Push is not configured (missing or invalid VAPID public key).");
      return;
    }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError(
          permission === "denied"
            ? "Notifications are blocked. Enable them in your browser settings."
            : "Notification permission was not granted."
        );
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      setEnabled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enable notifications.");
    } finally {
      setBusy(false);
    }
  }, [isOnline]);

  const disable = useCallback(async () => {
    setError(null);
    if (!isOnline) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
      setEnabled(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disable notifications.");
    } finally {
      setBusy(false);
    }
  }, [isOnline]);

  return (
    <SettingsPanel
      icon={Bell}
      title="Notifications"
      description="A push when a task is due, assigned to you, or commented on. Tapping it opens the task."
    >
      {support.state === "ios-needs-install" && (
        <div className="flex items-start gap-3 rounded-xl bg-muted/30 px-3.5 py-3 text-sm">
          <Smartphone className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div>
            <span className="font-medium">Add Rooftap to your Home Screen</span>
            <p className="text-muted-foreground mt-0.5">
              On iPhone and iPad, notifications only work once Rooftap is installed. In Safari, tap
              Share, then Add to Home Screen, and open it from there.
            </p>
          </div>
        </div>
      )}

      {support.state === "unsupported" && (
        <p className="text-sm text-muted-foreground">
          This browser doesn&apos;t support push notifications.
        </p>
      )}

      {support.state === "no-active-worker" && (
        <p className="text-sm text-muted-foreground">
          {process.env.NODE_ENV === "production"
            ? "Push notifications aren't available right now."
            : "Push notifications are unavailable in development."}
        </p>
      )}

      {support.state === "checking" && (
        <p className="text-sm text-muted-foreground">Checking push support…</p>
      )}

      {support.state === "ready" && (
        <SettingsInset>
          <SettingsSwitchRow
            title="Task notifications"
            description={busy ? "Working…" : enabled ? "On for this browser" : undefined}
            checked={enabled}
            onChange={() => void (enabled ? disable() : enable())}
            disabled={busy || !isOnline}
          />
        </SettingsInset>
      )}
      {support.state === "ready" && !isOnline && <OfflineHint />}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <LeaveAlertSetting />
    </SettingsPanel>
  );
}

/** How long before leaving an event's "time to leave" push comes (user_settings.leave_alert_minutes). */
function LeaveAlertSetting() {
  const { userSettings, refresh, isOnline } = useDataCache();
  const modules = useModules();
  const saved = String(leaveAlertMinutes(userSettings));
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);
  if (!modules.enabled.has("calendar")) return null;

  const change = async (next: string) => {
    setValue(next);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("user_settings")
      .upsert({ user_id: user.id, leave_alert_minutes: Number(next), updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    await refresh();
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Time to leave</span>
        <SegmentedControl
          ariaLabel="Time to leave alert"
          size="sm"
          value={value}
          onChange={(v) => void change(v)}
          options={LEAVE_ALERT_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        How long before you need to set off the push comes, for events with Getting there on.
      </p>
      {!isOnline && <OfflineHint />}
    </div>
  );
}
