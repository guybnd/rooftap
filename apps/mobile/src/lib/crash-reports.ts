// The phone's side of crash reports (core crash-report.ts): what the error
// screen knows about the app, and how a report reaches the server. Reports
// go only to the server this phone signs in to (POST /api/feedback/crash),
// never anywhere else; that server decides whether they go on to the
// Rooftap team.
import * as React from 'react';
import { Platform } from 'react-native';
import { usePathname } from 'expo-router';
import * as Updates from 'expo-updates';
import { sendKeptCrashes, type CrashContext, type CrashReceipt, type CrashSender } from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { getStoredServer } from '@/lib/server-config';

// The error screen sits above the router's providers, so it can't ask for
// the path itself. A leaf in the root layout keeps the last one here.
let lastPath: string | null = null;

/** Keeps the current path for a crash report; only its pattern is ever sent. */
export function CrashPathTracker() {
  const path = usePathname();
  React.useEffect(() => {
    lastPath = path;
  }, [path]);
  return null;
}

/** What a report says about this phone and app. */
export function crashContext(): CrashContext {
  const ios = Platform.OS === 'ios';
  return {
    platform: ios ? 'ios' : 'android',
    path: lastPath,
    os: ios ? `iOS ${Platform.Version}` : `Android API ${Platform.Version}`,
    app: Updates.runtimeVersion ?? null,
    build: process.env.EXPO_PUBLIC_GIT_SHA?.slice(0, 7) ?? Updates.updateId?.slice(0, 8) ?? null,
  };
}

/**
 * Sends one report to this phone's server. Throws when the server can't be
 * reached, so the report is kept for later; answers null when it won't take
 * one (signed out, an older server, over its limit).
 */
export const sendCrash: CrashSender = async (report) => {
  const server = await getStoredServer().catch(() => null);
  if (!server) return null;
  const {
    data: { session },
  } = await getCurrentSupabaseClient().auth.getSession();
  if (!session?.access_token) return null;
  const res = await fetch(`${server.origin}/api/feedback/crash`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (!res.ok) return null;
  return (await res.json()) as CrashReceipt;
};

/** A little after launch, sends the reports kept while the phone was offline. */
export function useSendKeptCrashes() {
  React.useEffect(() => {
    const timer = setTimeout(() => void sendKeptCrashes(sendCrash).catch(() => undefined), 15_000);
    return () => clearTimeout(timer);
  }, []);
}
