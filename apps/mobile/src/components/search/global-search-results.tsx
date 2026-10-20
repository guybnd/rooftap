// HOUP-147: native results view for the capture sheet's global search step —
// consumes the shared core index (packages/core/src/hooks/use-global-search-index.ts)
// the same way web's capture sheet does, and renders the same grouped
// ListGroup sections (web twin: apps/web/src/components/capture/capture-search-results.tsx).
//
// A hit renders as its section's REAL line item whenever one exists (the
// caller's `renderRow`: the Tasks screen's TaskRow, the grocery card, the
// cost row, the setup card, the checklist and recipe rows), so a found item
// swipes, ticks, holds and taps exactly as it does on its own screen. Only a
// hit with no row of its own (a viewing, an apartment, a document, a
// viewing-checklist item) falls back to a plain row: the section's leading
// tile, the title, one meta line and a chevron.
import * as React from 'react';
import { useWindowDimensions, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import {
  Text,
  BottomSheetScrollView,
  LeadingTile,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
} from '@homeup/ui';
import { GLOBAL_HIT_SECTION_ID, resolveGlobalHitAction, type GlobalHit } from '@homeup/core/src/hooks/use-global-search-index';
import { sectionIconFor } from '@/lib/section-icons';

// The results scroll inside the sheet, capped so the sheet, the search field
// and the keyboard always fit together (web caps the same list at 34dvh).
const RESULTS_MAX_HEIGHT_FRACTION = 0.34;

/** Results cap across all sections, matching web's compact launcher. */
export const GLOBAL_SEARCH_RESULT_LIMIT = 3;

export interface GlobalSearchResultsProps {
  /** The ranked, capped hits to show (core's index through useFuzzySearch). */
  hits: GlobalHit[];
  /** The query, for the no-match line. */
  query: string;
  docsLoading?: boolean;
  /**
   * The hit as its section's real line item, or null when the section has
   * no row of its own (or the record isn't loaded): the plain row stands in.
   */
  renderRow: (hit: GlobalHit) => React.ReactNode | null;
  /** A plain row's tap: navigate to the hit, or open its sheet. */
  onHitPress: (hit: GlobalHit) => void;
}

/** A hit with no row of its own: section tile, title, one meta line, chevron. */
function PlainHitRow({ hit, onPress }: { hit: GlobalHit; onPress: () => void }) {
  const sectionId = GLOBAL_HIT_SECTION_ID[hit.section];
  const action = resolveGlobalHitAction(hit);
  return (
    <ListItem onPress={onPress} accessibilityRole="button" className="items-center">
      <LeadingTile sectionId={sectionId} Icon={sectionIconFor(sectionId)} size="md" />
      <ListItemContent>
        <ListItemTitle>{hit.title}</ListItemTitle>
        {hit.subtitle ? (
          <ListItemMeta>
            <Text numberOfLines={1} className="text-caption text-muted-foreground">
              {hit.subtitle}
            </Text>
          </ListItemMeta>
        ) : null}
      </ListItemContent>
      {action.kind === 'nav' && (
        <ListItemTrailing>
          <ChevronRight size={16} className="text-muted-foreground" />
        </ListItemTrailing>
      )}
    </ListItem>
  );
}

export function GlobalSearchResults({ hits, query, docsLoading, renderRow, onHitPress }: GlobalSearchResultsProps) {
  const { height: windowHeight } = useWindowDimensions();

  if (hits.length === 0) {
    return (
      <Text className="px-1 text-body text-muted-foreground">
        {docsLoading ? 'Searching…' : `No matches for "${query.trim()}"`}
      </Text>
    );
  }

  // Group the (already relevance-ranked, capped) hits by sectionLabel so
  // same-section results cluster under one micro-label header instead of
  // repeating the section name on every row.
  const groups: { label: string; hits: GlobalHit[] }[] = [];
  for (const hit of hits) {
    const group = groups.find((g) => g.label === hit.sectionLabel);
    if (group) group.hits.push(hit);
    else groups.push({ label: hit.sectionLabel, hits: [hit] });
  }

  return (
    // BottomSheetScrollView (not a bare ScrollView): it reports its offset to
    // the sheet, so a pull-down only dismisses from the top, and runs its
    // native gesture alongside the sheet's. Rows keep their own horizontal
    // swipe: SwipeActions activates at 8px across and fails at 16px down,
    // while the sheet's dismiss activates at 12px down and fails at 16px
    // across, so the first clear axis wins.
    <BottomSheetScrollView style={{ maxHeight: windowHeight * RESULTS_MAX_HEIGHT_FRACTION }} keyboardShouldPersistTaps="handled">
      <View className="gap-3">
        {groups.map((group) => (
          <View key={group.label}>
            <Text className="cap-inscription mb-1 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {group.label}
            </Text>
            {/* H4: one bordered card per list, hairlines between rows. */}
            <ListGroup>
              {group.hits.map((hit) => (
                <React.Fragment key={`${hit.section}-${hit.id}`}>
                  {renderRow(hit) ?? <PlainHitRow hit={hit} onPress={() => onHitPress(hit)} />}
                </React.Fragment>
              ))}
            </ListGroup>
          </View>
        ))}
      </View>
    </BottomSheetScrollView>
  );
}
