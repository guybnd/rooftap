// HOUP-148: root-mounted sibling (same mount pattern as this file's
// `WidgetSync` in _layout.tsx) that drains a pending Android share intent
// (expo-share-intent's `useShareIntent()`) and routes it, keyed off the
// share's MIME-derived `type` — URL and .ics shares are unambiguously a
// listing/calendar-import destination and route immediately; an image/file
// share is ambiguous, so it opens the share action picker instead (HOUP-265 —
// previously this unconditionally staged the image(s) and routed to
// `/apartment/new`, the "goes straight into home search" bug).
//
// `app/+native-intent.ts` handles the cold-start deep link redirect so
// expo-router never tries to resolve the raw share-extension path; this
// component picks the intent up once expo-share-intent has parsed it,
// regardless of which screen the redirect landed on.
import { useEffect, useMemo, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter, type Href } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { toast } from '@homeup/ui';
import { getEnabledModules, isFeatureEnabled, listDocumentTags } from '@homeup/core';
import { setPendingShareIcs } from '@/lib/share-ingest';
import { resolveShareRoute, type ShareIntentFileLike } from '@/lib/share-intent-routing';
import { useDataCache } from '@/lib/data-cache';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { CaptureFlow, type CaptureFlowInitialShare } from '@/components/documents/capture-flow';
import { useOpenRoute } from '@/lib/tab-routes';

export function ShareIntentHandler() {
  const router = useRouter();
  const openRoute = useOpenRoute();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const { group } = useDataCache();
  const groupId = group?.id ?? null;

  // HOUP-265: the share action picker — <CaptureFlow/> opened directly at its
  // category step with these file(s) preloaded. Held as plain component
  // state (not a share-ingest module slot) since CaptureFlow is mounted
  // right here, not reached via router — no oversized-param hand-off to
  // avoid, unlike the .ics/apartment-listing paths below which do cross a
  // screen boundary.
  const [shareFiles, setShareFiles] = useState<ShareIntentFileLike[] | null>(null);
  const [groupTags, setGroupTags] = useState<string[]>([]);

  useEffect(() => {
    if (!shareFiles || !groupId) return;
    const supabase = getCurrentSupabaseClient();
    listDocumentTags(supabase, groupId).then(setGroupTags).catch(() => {});
  }, [shareFiles, groupId]);

  useEffect(() => {
    if (!hasShareIntent) return;

    let cancelled = false;

    (async () => {
      // Modules: only destinations whose modules are on (module-features.ts).
      const enabled = getEnabledModules();
      const decision = resolveShareRoute(shareIntent, (id) => isFeatureEnabled(id, enabled));
      if (decision.kind === 'weburl') {
        openRoute(decision.href);
      } else if (decision.kind === 'media') {
        // Pre-login share race (ticket Risks): a group isn't guaranteed yet
        // when this fires, and the picker's uploadDocument/cost/grocery
        // writes need one — default to a sign-in prompt rather than a
        // silent drop or deferring the intent across renders.
        if (!groupId) {
          toast.message('Sign in first, then reopen the share to add this.');
        } else {
          setShareFiles(decision.files);
        }
      } else if (decision.kind === 'ics') {
        const text = await FileSystem.readAsStringAsync(decision.file.path);
        if (cancelled) return;
        setPendingShareIcs(text);
        router.push('/apartment/share-calendar' as Href);
      } else if (decision.kind === 'unavailable') {
        toast.message('Nothing in Rooftap can take this yet.');
      } else {
        // AC: an unhandled mime (kind:'none') must surface, not silently drop.
        toast.error("Can't add this file from a share. Try a photo or image instead.");
      }
      if (!cancelled) resetShareIntent();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent]);

  // Memoized on `shareFiles` (not recreated every render) — CaptureFlow's
  // initialShare-seeding effect depends on this by reference and would
  // otherwise re-seed (jumping the user back to `category`) on any unrelated
  // re-render of this component (e.g. the groupTags fetch above resolving).
  const initialShare: CaptureFlowInitialShare | undefined = useMemo(
    () =>
      shareFiles
        ? { files: shareFiles.map((f) => ({ uri: f.path, filename: f.fileName, mimeType: f.mimeType })) }
        : undefined,
    [shareFiles]
  );

  if (!groupId) return null;

  return (
    <CaptureFlow
      open={!!shareFiles}
      onClose={() => setShareFiles(null)}
      groupId={groupId}
      groupTags={groupTags}
      onUploaded={() => setShareFiles(null)}
      initialShare={initialShare}
    />
  );
}
