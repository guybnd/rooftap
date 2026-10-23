"use client";

import { useState, useEffect, useCallback } from "react";
import { SettingsInset, SettingsLabel, SettingsPanel, SettingsSwitchRow } from "@/components/settings-panel";
import { ReplyNotificationRows } from "@/components/assistant-settings";
import { Bell, BellRing, Smartphone } from "lucide-react";
import { useDataCache } from "@/lib/data-cache";
import { OfflineHint } from "@/components/offline-hint";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { createClient } from "@/lib/supabase/client";
import { LEAVE_ALERT_OPTIONS, leaveAlertMinutes, useModules, type ModuleId } from "@homeup/core";

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
      title="Push notifications"
      description="Rooftap sends these to this browser. Clicking one opens what it is about."
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
            title="In this browser"
            description={busy ? "Working…" : enabled ? "On for this browser" : undefined}
            checked={enabled}
            onChange={() => void (enabled ? disable() : enable())}
            disabled={busy || !isOnline}
          />
        </SettingsInset>
      )}
      {support.state === "ready" && !isOnline && <OfflineHint />}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </SettingsPanel>
  );
}

/** A kind of push with no switch of its own: the switch above covers it. */
function KindRow({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[52px] items-center px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

/** Every push the app sends, grouped by module, with the switches each one has. */
export function NotificationKinds() {
  const modules = useModules();
  const has = (id: ModuleId) => modules.enabled.has(id);
  const assistant = has("assistant") && modules.server("assistant.reply-notifications");
  if (!has("household") && !has("calendar") && !assistant && !has("shopper")) return null;

  return (
    <SettingsPanel icon={BellRing} title="What you get" description="Pushes for the modules your home uses.">
      {has("household") && (
        <div className="space-y-1.5">
          <SettingsLabel>Tasks</SettingsLabel>
          <SettingsInset>
            <KindRow title="Due, assigned or commented" description="When a task is due, someone gives you one, or someone comments on yours." />
          </SettingsInset>
        </div>
      )}
      {has("calendar") && (
        <div className="space-y-1.5">
          <SettingsLabel>Calendar</SettingsLabel>
          <SettingsInset>
            <KindRow title="Event reminders" description="A week and a day before, or on the days an event picks." />
            <LeaveAlertSetting />
          </SettingsInset>
        </div>
      )}
      {assistant && (
        <div className="space-y-1.5">
          <SettingsLabel>Assistant</SettingsLabel>
          <ReplyNotificationRows
            description={
              has("money-insights")
                ? "When Rooftap answers after you leave, a new Household message, or a money note."
                : "When Rooftap answers after you leave, or a new Household message."
            }
          />
        </div>
      )}
      {has("shopper") && (
        <div className="space-y-1.5">
          <SettingsLabel>Shopper</SettingsLabel>
          <SettingsInset>
            <KindRow title="Scout results" description="When a search you started has its picks." />
          </SettingsInset>
        </div>
      )}
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
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-medium text-foreground">Time to leave</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          How long before you need to set off, for events with Getting there on.
        </p>
        {!isOnline && <OfflineHint />}
      </div>
      <SegmentedControl
        ariaLabel="Time to leave alert"
        size="sm"
        value={value}
        onChange={(v) => void change(v)}
        options={LEAVE_ALERT_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
      />
    </div>
  );
}
