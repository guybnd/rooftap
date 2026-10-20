export interface OfflineRow {
  id: string;
  title: string;
  meta?: string;
}

export interface OfflineSummary {
  label: string;
  rows: OfflineRow[];
  emptyLabel: string;
}

/**
 * Picks which local-data summary to show for the detected section. Sections
 * with no local-first store of their own (the Home hub, Documents, Settings,
 * or an unrecognized id) fall back to the cross-section overview rather than
 * rendering nothing.
 */
export function pickOfflineSummary(
  sectionId: string,
  bySection: Record<string, OfflineSummary>
): OfflineSummary {
  return bySection[sectionId] ?? bySection.overview;
}
