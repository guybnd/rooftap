// App-wide OTA toasts, the passive counterpart to the About & updates panel
// (features/settings/panels/app-updates.tsx). checkAutomatically: 'ON_LOAD'
// with fallbackToCacheTimeout: 0 (app.config.ts) downloads a new bundle in
// the background and only applies it on the NEXT cold launch, so without a
// signal the user can't tell an update is waiting or that one just landed.
//
// ON_LOAD only checks on a cold launch, and Android keeps the app alive in
// the background for days, so updates were only ever found by tapping
// "Check for updates". This hook also checks (and downloads) whenever the
// app returns to the foreground, at most every RESUME_CHECK_INTERVAL_MS.
//
// - "Update ready": fires once per downloaded update while the app is open,
//   with a Restart action that applies it now.
// - "App updated": fires once on the first launch running a new OTA, naming
//   the commit CI set (lib/build-info.ts), same value as the panel's
//   Commit row.
//
// - "Rooftap 1.1.3 is out": once per release whose APK has a newer native
//   build than this phone (core app-release.ts), with a Get it action that
//   opens the release page. Until then this phone gets no more OTAs, so the
//   toast is the only sign. A phone too old for its server hears it on every
//   launch.
//
// - "Server update: Rooftap 1.2.0": once per release for the people who run
//   a self-hosted server that is behind (GET /api/server-update), with a How
//   to update action that opens About & updates. Web has the same toast
//   (components/server-update.tsx).
//
// Mobile only: web is served fresh per deploy and has no pending-bundle state.
import * as React from 'react';
import { AppState, Linking } from 'react-native';
import * as Updates from 'expo-updates';
import { useRouter } from 'expo-router';
import { toast } from '@homeup/ui';
import {
  SEEN_APP_RELEASE_KEY,
  SEEN_SERVER_UPDATE_KEY,
  appStanding,
  appUpdateNotice,
  serverUpdateNotice,
  shouldAnnounceRelease,
  shouldAnnounceServerUpdate,
  useServerRelease,
  useServerUpdate,
} from '@homeup/core';
import { fetchServerUpdate } from '@/features/settings/server-update-api';
import { useDataCache } from './data-cache';
import { nativeStoreEnvironment } from './legend/environment';
import { buildCommit } from './build-info';
import {
  LAST_SEEN_UPDATE_KEY,
  appliedDescription,
  resolveLaunch,
  shouldCheckOnResume,
} from './update-toast-logic';

const READY_TOAST_MS = 10000;
const RELEASE_TOAST_MS = 15000;

export function useUpdateToasts(): void {
  const { currentlyRunning, isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const announcedReady = React.useRef<string | null>(null);
  const release = useServerRelease();
  const announcedRelease = React.useRef(false);
  const router = useRouter();
  const serverUpdate = useServerUpdate(fetchServerUpdate, useDataCache().currentUserId);

  React.useEffect(() => {
    if (!Updates.isEnabled) return;
    let lastSeen: string | null = null;
    try {
      lastSeen = nativeStoreEnvironment.keyValue.getItem(LAST_SEEN_UPDATE_KEY);
    } catch {
      return;
    }
    const { remember, announceApplied } = resolveLaunch(lastSeen, currentlyRunning);
    try {
      nativeStoreEnvironment.keyValue.setItem(LAST_SEEN_UPDATE_KEY, remember);
    } catch {
      // Storage unavailable: worst case the toast repeats next launch.
    }
    if (announceApplied) {
      toast.success('App updated', {
        description: appliedDescription(buildCommit()),
        placement: 'top',
      });
    }
    // Launch-time only: currentlyRunning can't change without a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Launch counts as a check: ON_LOAD already ran one natively.
  const lastCheck = React.useRef<number | null>(Date.now());
  const pendingRef = React.useRef(isUpdatePending);
  pendingRef.current = isUpdatePending;

  React.useEffect(() => {
    if (!Updates.isEnabled) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || pendingRef.current) return;
      const now = Date.now();
      if (!shouldCheckOnResume(lastCheck.current, now)) return;
      lastCheck.current = now;
      // Silent: a failed background check (offline, server hiccup) just
      // waits for the next resume. Downloading flips isUpdatePending,
      // which shows the "Update ready" toast below.
      Updates.checkForUpdateAsync()
        .then((result) => (result.isAvailable ? Updates.fetchUpdateAsync() : undefined))
        .catch(() => {});
    });
    return () => sub.remove();
  }, []);

  React.useEffect(() => {
    if (!Updates.isEnabled || !isUpdatePending) return;
    const id = downloadedUpdate?.updateId ?? 'pending';
    if (announcedReady.current === id) return;
    announcedReady.current = id;
    toast.message('Update ready', {
      description: 'Restart to apply it now, or it applies on next launch.',
      duration: READY_TOAST_MS,
      placement: 'top',
      action: {
        label: 'Restart',
        onPress: () => {
          Updates.reloadAsync().catch(() => {
            toast.error('Could not restart', {
              description: 'The update applies on next launch.',
              placement: 'top',
            });
          });
        },
      },
    });
  }, [isUpdatePending, downloadedUpdate?.updateId]);

  // The stored config answers first and the refresh may bring a newer
  // release, so only a notice ends the watch for this launch.
  React.useEffect(() => {
    if (announcedRelease.current) return;
    const standing = appStanding(Updates.runtimeVersion, release);
    if (standing.kind === 'unknown' || standing.kind === 'current') return;
    announcedRelease.current = true;
    let seen: string | null = null;
    try {
      seen = nativeStoreEnvironment.keyValue.getItem(SEEN_APP_RELEASE_KEY);
    } catch {
      // Storage unavailable: announce, and maybe again next launch.
    }
    const notice = appUpdateNotice(standing);
    if (!notice || !shouldAnnounceRelease(standing, seen)) return;
    if (standing.kind === 'update') {
      try {
        nativeStoreEnvironment.keyValue.setItem(SEEN_APP_RELEASE_KEY, standing.latest.version);
      } catch {
        // Worst case the toast repeats next launch.
      }
    }
    const url = standing.latest?.url;
    toast.message(notice.title, {
      description: notice.description,
      duration: RELEASE_TOAST_MS,
      placement: 'top',
      ...(url ? { action: { label: 'Get it', onPress: () => void Linking.openURL(url).catch(() => {}) } } : {}),
    });
  }, [release]);

  React.useEffect(() => {
    if (!serverUpdate) return;
    let seen: string | null = null;
    try {
      seen = nativeStoreEnvironment.keyValue.getItem(SEEN_SERVER_UPDATE_KEY);
    } catch {
      // Storage unavailable: announce, and maybe again next launch.
    }
    if (!shouldAnnounceServerUpdate(serverUpdate, seen)) return;
    try {
      nativeStoreEnvironment.keyValue.setItem(SEEN_SERVER_UPDATE_KEY, serverUpdate.latest);
    } catch {
      // Worst case the toast repeats next launch.
    }
    const notice = serverUpdateNotice(serverUpdate);
    toast.message(notice.title, {
      description: notice.description,
      duration: RELEASE_TOAST_MS,
      placement: 'top',
      action: { label: 'How to update', onPress: () => router.push('/settings/about') },
    });
  }, [serverUpdate, router]);
}
