import * as React from 'react';
import { Pressable, View } from 'react-native';
import { ChevronDown, Plus, X } from 'lucide-react-native';
import { Text, Button, HeroLede, SectionSearchBar, SegmentedControl, cn } from '@homeup/ui';
import { FolderPath, NewFolderButton } from '@/components/documents/folder-ui';
import { docTypeLabel, type DocumentFolder, PRESETS, sameSet, TYPE_FILTERS, type DocType } from '@homeup/core';

export type ExpiryFilter = 'all' | 'soon' | 'expired';

export const EXPIRY_OPTIONS: { value: ExpiryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'soon', label: 'Expiring' },
  { value: 'expired', label: 'Expired' },
];

/** A filter chip: ~32px to the eye, hit slop takes the touch target to 44px (F). */
export function FilterChip({
  active,
  onPress,
  children,
  accessibilityLabel,
  expanded,
}: {
  active: boolean;
  onPress: () => void;
  children: React.ReactNode;
  accessibilityLabel?: string;
  /** Set for a disclosure chip instead of a toggle. */
  expanded?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={expanded === undefined ? { selected: active } : { expanded }}
      className={cn('min-h-8 flex-row items-center gap-1 rounded-full px-3', active ? 'bg-primary' : 'bg-muted')}
    >
      {children}
    </Pressable>
  );
}

export const chipText = (active: boolean) =>
  cn('text-xs font-medium', active ? 'text-primary-foreground' : 'text-muted-foreground');

export interface DocumentsListHeaderProps {
  /** The Hero lede: what the screen (or the open folder) holds; null until the first load lands. */
  lede: { value: number; label: string; soon: number; expired: number } | null;
  /** Search and filters; hidden while there is nothing to filter. */
  showFilters: boolean;
  onAddDocument: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  expiryFilter: ExpiryFilter;
  onExpiryFilterChange: (value: ExpiryFilter) => void;
  sortLabel: string;
  onOpenSort: () => void;
  categoryFilters: Set<DocType>;
  typesOpen: boolean;
  onToggleTypes: () => void;
  onToggleCategory: (c: DocType) => void;
  onSelectPreset: (types: DocType[], active: boolean) => void;
  onClearFilters: () => void;
  tagFilters: string[];
  onToggleTagFilter: (t: string) => void;
  folders: DocumentFolder[];
  folderId: string | null;
  onNavigateFolder: (id: string | null) => void;
  onNewFolder: () => void;
  browsing: boolean;
}

/** HOUP-205: the documents filter/search cluster, hoisted into `FlashList`'s `ListHeaderComponent`
 * so it scrolls with content. Passed as a memoized element (never an inline closure) — see the
 * `listHeader` memo below — so its `SectionSearchBar` TextInput never remounts mid-type. */
export function DocumentsListHeader({
  lede,
  showFilters,
  onAddDocument,
  search,
  onSearchChange,
  expiryFilter,
  onExpiryFilterChange,
  sortLabel,
  onOpenSort,
  categoryFilters,
  typesOpen,
  onToggleTypes,
  onToggleCategory,
  onSelectPreset,
  onClearFilters,
  tagFilters,
  onToggleTagFilter,
  folders,
  folderId,
  onNavigateFolder,
  onNewFolder,
  browsing,
}: DocumentsListHeaderProps) {
  return (
    <View className="gap-3 pb-1">
      {/* Section screen head (Hearth §11): the screen's name, or the path to
          the open folder, on the left; its actions on the right. M1: "Add"
          lives here, not a floating button stacked over the tab bar's
          capture FAB. While a search or filter spans the whole tree the path
          would lie, so it reads plain "Documents" then. */}
      <View className="min-h-9 flex-row items-center justify-between gap-3">
        <FolderPath folders={folders} folderId={browsing ? folderId : null} onNavigate={onNavigateFolder} />
        <View className="flex-row items-center gap-2">
          {browsing && <NewFolderButton onPress={onNewFolder} />}
          <Button size="sm" hitSlop={4} onPress={onAddDocument} accessibilityLabel="Add document">
            <Plus size={14} className="text-primary-foreground" />
            <Text className="text-sm font-medium text-primary-foreground">Add</Text>
          </Button>
        </View>
      </View>

      {/* H1: one lede, on the ground. At the top level it counts every
          document; inside a folder, what the folder holds ("3 in Home").
          Held back until the first load lands, so it never flashes "0". */}
      {lede && (
        <HeroLede
          className="mb-2"
          value={lede.value}
          label={lede.label}
          caption={
            lede.soon > 0 || lede.expired > 0 ? (
              <>
                {lede.soon > 0 && <Text className="text-caption text-warning">{lede.soon} expiring soon</Text>}
                {lede.soon > 0 && lede.expired > 0 && ' · '}
                {lede.expired > 0 && <Text className="text-caption text-destructive">{lede.expired} expired</Text>}
              </>
            ) : undefined
          }
        />
      )}

      {/* Filters (H5), inset controls directly above the list they scope.
          With nothing filed yet there is nothing to filter, so they hide (H)
          and "Add" above stays the way in. */}
      {showFilters && (
        <>
          <SectionSearchBar value={search} onChange={onSearchChange} placeholder="Search documents…" />

          {/* H5: the expiry filter is a recessed segmented track (one border
              level, H4); sort is a compact control beside it that opens a
              BottomSheet picker. */}
          <View className="flex-row items-center gap-2">
            <SegmentedControl
              options={EXPIRY_OPTIONS}
              value={expiryFilter}
              onChange={onExpiryFilterChange}
              size="sm"
              accessibilityLabel="Filter by expiry"
              className="min-h-11 flex-1"
            />
            <Pressable
              onPress={onOpenSort}
              accessibilityRole="button"
              accessibilityLabel={`Sort documents, ${sortLabel}`}
              className="min-h-11 flex-row items-center gap-1 rounded-lg bg-muted/40 px-3"
            >
              <Text className="text-xs font-medium text-foreground">{sortLabel}</Text>
              <ChevronDown size={14} className="text-muted-foreground" />
            </Pressable>
          </View>

          {/* Quick presets, then every type behind "More types" (H: chrome
              shrinks). Wrapping, not a scroller, so no chip clips at an edge. */}
          <View className="flex-row flex-wrap items-center gap-x-1.5 gap-y-3">
            {PRESETS.map((p) => {
              const active = sameSet(categoryFilters, p.types);
              return (
                <FilterChip key={p.label} active={active} onPress={() => onSelectPreset(p.types, active)}>
                  <Text className={chipText(active)}>{p.label}</Text>
                </FilterChip>
              );
            })}
            <FilterChip active={false} expanded={typesOpen} onPress={onToggleTypes} accessibilityLabel="More types">
              <Text className={chipText(false)}>More types</Text>
              <ChevronDown
                size={14}
                className="text-muted-foreground"
                style={typesOpen ? { transform: [{ rotate: '180deg' }] } : undefined}
              />
            </FilterChip>
            {(categoryFilters.size > 0 || tagFilters.length > 0) && (
              <Pressable onPress={onClearFilters} hitSlop={8} accessibilityRole="button" className="min-h-8 justify-center px-2">
                <Text className="text-xs font-medium text-primary">Clear</Text>
              </Pressable>
            )}
          </View>

          {typesOpen && (
            <View className="flex-row flex-wrap gap-x-1.5 gap-y-3">
              {TYPE_FILTERS.map((t) => {
                const active = categoryFilters.has(t);
                return (
                  <FilterChip key={t} active={active} onPress={() => onToggleCategory(t)}>
                    <Text className={chipText(active)}>{docTypeLabel(t)}</Text>
                  </FilterChip>
                );
              })}
            </View>
          )}

          {tagFilters.length > 0 && (
            <View className="flex-row flex-wrap items-center gap-x-1.5 gap-y-3">
              {tagFilters.map((t) => (
                <FilterChip key={t} active onPress={() => onToggleTagFilter(t)} accessibilityLabel={`Remove tag filter ${t}`}>
                  <Text className={chipText(true)}>#{t}</Text>
                  <X size={12} className="text-primary-foreground" />
                </FilterChip>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}
