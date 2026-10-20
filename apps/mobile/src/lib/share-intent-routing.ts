// HOUP-148: the pure intent-type -> destination decision <ShareIntentHandler/>
// (apps/mobile/src/components/share-intent-handler.tsx) acts on. Split out
// so the MIME-type branching (the part of the handler with real decision
// logic) is unit-testable without mocking expo-share-intent/expo-router/
// expo-file-system — see this file's .test.ts for the "given an intent
// shape, assert the target route" coverage the ticket's plan recommended.
import { isCaptureCategoryEnabled, type CaptureCategoryId, type ModuleFeatureId } from '@homeup/core';

export interface ShareIntentFileLike {
  path: string;
  mimeType: string;
  fileName: string;
}

export interface MinimalShareIntent {
  type: 'media' | 'file' | 'text' | 'weburl' | null;
  webUrl: string | null;
  files: ShareIntentFileLike[] | null;
}

export type ShareRouteDecision =
  | { kind: 'weburl'; href: string }
  | { kind: 'media'; files: ShareIntentFileLike[] }
  | { kind: 'ics'; file: ShareIntentFileLike }
  /** Every place that could take this share is in a switched-off module. */
  | { kind: 'unavailable' }
  | { kind: 'none' };

export function isIcsFile(file: { mimeType: string; fileName: string }): boolean {
  return file.mimeType === 'text/calendar' || file.fileName.toLowerCase().endsWith('.ics');
}

/** The share action picker's categories, in <CaptureFlow/>'s SHARE_CATEGORIES order. */
export const SHARE_CATEGORY_IDS = ['document', 'invoice', 'grocery', 'apartment'] as const satisfies readonly CaptureCategoryId[];

/** The share categories whose modules are on. `feature` answers a module-features.ts id. */
export function availableShareCategories(feature: (id: ModuleFeatureId) => boolean): CaptureCategoryId[] {
  return SHARE_CATEGORY_IDS.filter((id) => isCaptureCategoryEnabled(id, feature));
}

// HOUP-265: `media` carries the full file list (not just uris) so the
// consumer can open the share action picker — <CaptureFlow/>'s "Save doc"/
// "Add a cost"/"Add grocery bill" paths need each file's mimeType/fileName,
// not only its uri (only the "Add apartment listing" branch needs uris).
// Modules: a destination whose module is off is never offered; when none is
// left the share resolves to `unavailable` (module-features.ts).
export function resolveShareRoute(
  intent: MinimalShareIntent,
  feature: (id: ModuleFeatureId) => boolean
): ShareRouteDecision {
  if (intent.type === 'weburl' && intent.webUrl) {
    if (!feature('capture.listing')) return { kind: 'unavailable' };
    return { kind: 'weburl', href: `/apartment/new?listing_url=${encodeURIComponent(intent.webUrl)}` };
  }
  if (intent.type === 'media' && intent.files?.length) {
    // Two or more files skip the picker and are saved as documents.
    const usable =
      intent.files.length > 1 ? feature('capture.document') : availableShareCategories(feature).length > 0;
    return usable ? { kind: 'media', files: intent.files } : { kind: 'unavailable' };
  }
  if (intent.type === 'file' && intent.files?.length) {
    const icsFile = intent.files.find(isIcsFile);
    if (icsFile) return feature('capture.calendar-file') ? { kind: 'ics', file: icsFile } : { kind: 'unavailable' };
  }
  return { kind: 'none' };
}
