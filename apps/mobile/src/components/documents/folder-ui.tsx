// Folder chrome for the native Documents screen: the folder path that heads
// the screen, folder tiles, a name prompt, and the move sheet.
//
// Web asks for a folder name through the themed dialog.prompt; here the name
// prompt is a real sheet (Hearth M4: contextual input arrives as a sheet). Folders are tiles in a two-column grid
// under their own "Folders" label, and documents stay line items in one card
// under "Files", so a folder never reads as just another row. The move sheet
// lists destinations as rows to tap (Hearth M4). Web twin:
// apps/web/src/components/documents/folder-browser.tsx.

import * as React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Files,
  Folder,
  FolderInput,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react-native';
import {
  Text,
  Button,
  BottomSheet,
  BottomSheetScrollView,
  HoldFillOverlay,
  Input,
  ListGroup,
  ListItem,
  ListItemLeading,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
  Switch,
  cn,
  haptics,
  useHoldFill,
  useThemeMaterial,
} from '@homeup/ui';
import {
  folderBreadcrumb,
  folderContentsLabel,
  folderMoveOptions,
  MOTION_DURATIONS_MS,
  type DocumentFolder,
  dialog,
} from '@homeup/core';

/**
 * The screen's head label (Hearth §11 section screen head): "Documents" at
 * the top level, and the path to the open folder inside one, as micro labels
 * ("‹ Documents › Home"). Every crumb but the last climbs back up; the chevron
 * in front says the first one is a way back. Hidden paths never lie: the
 * screen shows plain "Documents" while a search spans the whole tree.
 */
export function FolderPath({
  folders,
  folderId,
  onNavigate,
}: {
  folders: DocumentFolder[];
  folderId: string | null;
  onNavigate: (id: string | null) => void;
}) {
  const path = folderBreadcrumb(folders, folderId);
  const label = 'text-micro-label uppercase';

  if (path.length === 0) {
    return (
      <Text accessibilityRole="header" className={cn(label, 'text-muted-foreground')}>
        Documents
      </Text>
    );
  }

  return (
    <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-x-1 gap-y-1" accessibilityLabel="Folder path">
      <Pressable
        onPress={() => onNavigate(null)}
        // The crumbs are micro labels to the eye; the slop takes each to 44px (M2).
        hitSlop={{ top: 15, bottom: 15, left: 8, right: 4 }}
        accessibilityRole="button"
        accessibilityLabel="Back to all documents"
        className="-ml-1 flex-row items-center gap-0.5"
      >
        <ChevronLeft size={14} className="text-muted-foreground" />
        <Text className={cn(label, 'text-muted-foreground')}>Documents</Text>
      </Pressable>
      {path.map((f, i) => {
        const last = i === path.length - 1;
        return (
          <View key={f.id} className="min-w-0 shrink flex-row items-center gap-1">
            <ChevronRight size={11} className="text-muted-foreground/60" />
            <Pressable
              onPress={last ? undefined : () => onNavigate(f.id)}
              disabled={last}
              hitSlop={{ top: 15, bottom: 15, left: 4, right: 4 }}
              accessibilityRole={last ? 'header' : 'button'}
              className="min-w-0 shrink"
            >
              <Text numberOfLines={1} className={cn(label, last ? 'text-foreground' : 'text-muted-foreground')}>
                {f.name}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export function NewFolderButton({ onPress }: { onPress: () => void }) {
  return (
    <Button variant="outline" size="sm" hitSlop={4} onPress={onPress} accessibilityLabel="New folder">
      <FolderPlus size={14} className="text-muted-foreground" />
      <Text className="text-xs font-medium text-muted-foreground">New folder</Text>
    </Button>
  );
}

/** A section label over the folder grid or a files card: micro label + count (Hearth §6 group header). */
export function DocumentsSectionLabel({ label, count, first }: { label: string; count: number; first: boolean }) {
  return (
    <View accessibilityRole="header" className={cn('flex-row items-baseline gap-2 px-1 pb-2', first ? 'pt-4' : 'pt-7')}>
      <Text className="text-micro-label uppercase text-muted-foreground">{label}</Text>
      <Text className="text-micro-label text-muted-foreground/60" style={{ fontVariant: ['tabular-nums'] }}>
        {count}
      </Text>
    </View>
  );
}

// Matches document-row.tsx's hold-to-edit timing (task rows' HOUP-198 value).
const LONG_PRESS_MS = 500;

/**
 * One folder as a tile in the two-column grid: its own card (H4: sibling
 * cards, never a card in a card), a folder glyph on a neutral inset tile (a
 * container is not state or identity, so no hue, H2), the name, and one line
 * of what it holds. Tap opens it; hold, or the trailing "more" button as the
 * visible path (M3), opens its actions. The tile owns its MoveMotion so a
 * folder filed away leaves, and one receiving an item swells, card and all.
 */
export function FolderTile({
  folder,
  folders,
  documents,
  onOpen,
  onRename,
  onMove,
  onDelete,
  leaving = false,
  receiving = false,
}: {
  folder: DocumentFolder;
  folders: DocumentFolder[];
  documents: { folderId?: string | null }[];
  onOpen: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  leaving?: boolean;
  receiving?: boolean;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const material = useThemeMaterial();
  const holdFill = useHoldFill(LONG_PRESS_MS);
  const contents = folderContentsLabel(folders, documents, folder.id);

  return (
    <>
      <MoveMotion
        leaving={leaving}
        receiving={receiving}
        className="flex-1 rounded-3xl border border-border/60 bg-card"
        style={{ boxShadow: material.cardShadow }}
      >
        <Pressable
          onPress={onOpen}
          onLongPress={() => {
            haptics.commit();
            setMenuOpen(true);
          }}
          delayLongPress={LONG_PRESS_MS}
          onPressIn={holdFill.start}
          onPressOut={holdFill.stop}
          accessibilityRole="button"
          accessibilityLabel={`${folder.name}, folder, ${contents}`}
          accessibilityHint="Opens the folder. Hold for folder actions."
          className="min-h-[112px] flex-1 p-3.5 active:bg-accent/30"
        >
          <HoldFillOverlay progress={holdFill.progress} />
          <View className="flex-row items-start justify-between">
            <View className="h-10 w-10 items-center justify-center rounded-2xl bg-muted">
              <Folder size={20} className="text-muted-foreground" />
            </View>
            <Pressable
              onPress={() => setMenuOpen(true)}
              hitSlop={4}
              accessibilityLabel={`${folder.name} actions`}
              accessibilityRole="button"
              className="-mr-2 -mt-2 h-11 w-11 items-center justify-center rounded-full"
            >
              <MoreHorizontal size={16} className="text-muted-foreground" />
            </Pressable>
          </View>
          <View className="mt-auto gap-0.5 pt-3">
            <Text numberOfLines={2} className="font-medium text-foreground">
              {folder.name}
            </Text>
            <Text numberOfLines={1} className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {contents}
            </Text>
          </View>
        </Pressable>
      </MoveMotion>

      <BottomSheet open={menuOpen} onOpenChange={setMenuOpen} className="pb-2">
        {/* E1: the sheet states the item before its verbs. */}
        <View className="flex-row items-center gap-3 border-b border-border px-4 pb-3">
          <View className="h-9 w-9 items-center justify-center rounded-xl bg-muted">
            <Folder size={16} className="text-muted-foreground" />
          </View>
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-body font-medium text-foreground">
              {folder.name}
            </Text>
            <Text className="text-caption text-muted-foreground">{contents}</Text>
          </View>
        </View>
        <ListGroup className="mx-1.5 mt-1.5 border-0 bg-transparent">
          <ListItem onPress={() => { setMenuOpen(false); onRename(); }}>
            <ListItemLeading><Pencil size={16} className="text-foreground" /></ListItemLeading>
            <ListItemTitle>Rename</ListItemTitle>
          </ListItem>
          <ListItem onPress={() => { setMenuOpen(false); onMove(); }}>
            <ListItemLeading><FolderInput size={16} className="text-foreground" /></ListItemLeading>
            <ListItemTitle>Move to folder</ListItemTitle>
          </ListItem>
          {/* E4: delete sits alone, last, danger text. */}
          <View className="my-1 h-px bg-border" />
          <ListItem onPress={() => { setMenuOpen(false); onDelete(); }}>
            <ListItemLeading><Trash2 size={16} className="text-destructive" /></ListItemLeading>
            <ListItemTitle className="text-destructive">Delete folder</ListItemTitle>
          </ListItem>
        </ListGroup>
      </BottomSheet>
    </>
  );
}

/** Name prompt for creating and renaming. */
export function FolderNameSheet({
  open,
  onOpenChange,
  title,
  initialValue,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initialValue: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = React.useState(initialValue);

  // Reopening for a different folder must not show the previous name.
  React.useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onOpenChange(false);
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <View className="gap-3 px-4 pb-6">
        <Text className="px-1 text-micro-label uppercase text-muted-foreground">{title}</Text>
        <Input
          value={value}
          onChangeText={setValue}
          placeholder="Folder name"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <Button onPress={submit} disabled={value.trim() === ''}>
          <Text>{submitLabel}</Text>
        </Button>
      </View>
    </BottomSheet>
  );
}

/** Above this many destinations the sheet grows a search field. */
const SEARCH_THRESHOLD = 8;

/**
 * Where to file a document or folder, in one step: the destinations are the
 * sheet's own rows, indented as a tree, so a tap moves it. The current
 * location carries a check, and "New folder" names one inline and files the
 * item straight into it, so filing never needs a second sheet (Hearth M4).
 */
export function FolderMoveSheet({
  open,
  onOpenChange,
  folders,
  movingFolderId,
  currentFolderId,
  title,
  itemName,
  onSelect,
  onCreateAndMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: DocumentFolder[];
  /** The folder being moved, whose subtree is no destination; null for a document. */
  movingFolderId: string | null;
  /** Where the item sits now; undefined when several items sit in different places. */
  currentFolderId: string | null | undefined;
  title: string;
  itemName: string | null;
  onSelect: (folderId: string | null) => void;
  onCreateAndMove: (name: string) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [naming, setNaming] = React.useState(false);
  const [name, setName] = React.useState('');

  // Each opening starts clean, whatever the last one left behind.
  React.useEffect(() => {
    if (open) {
      setQuery('');
      setNaming(false);
      setName('');
    }
  }, [open]);

  const options = React.useMemo(() => folderMoveOptions(folders, movingFolderId), [folders, movingFolderId]);
  const q = query.trim().toLowerCase();
  const searching = q !== '';
  const visible = searching
    ? options.filter((o) => [...o.path, o.folder.name].join(' ').toLowerCase().includes(q))
    : options;

  const pick = (folderId: string | null) => {
    onOpenChange(false);
    if (folderId !== currentFolderId) onSelect(folderId);
  };

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onOpenChange(false);
    onCreateAndMove(trimmed);
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} className="pb-2">
      <View className="gap-0.5 px-3.5 pb-2 pt-1">
        <Text className="text-micro-label uppercase text-muted-foreground">{title}</Text>
        {itemName ? (
          <Text className="text-body text-foreground" numberOfLines={1}>
            {itemName}
          </Text>
        ) : null}
      </View>

      {options.length > SEARCH_THRESHOLD && (
        <View className="px-3.5 pb-2">
          <Input value={query} onChangeText={setQuery} placeholder="Search folders" returnKeyType="search" />
        </View>
      )}

      <BottomSheetScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
        <ListGroup className="mx-1.5 mb-1.5 border-0 bg-transparent">
          {!searching && (
            <DestinationRow
              name="All documents"
              depth={0}
              root
              current={currentFolderId === null}
              onPress={() => pick(null)}
            />
          )}
          {visible.map((o) => (
            <DestinationRow
              key={o.folder.id}
              name={o.folder.name}
              depth={searching ? 0 : o.depth + 1}
              path={searching && o.path.length > 0 ? o.path.join(' / ') : undefined}
              current={o.folder.id === currentFolderId}
              onPress={() => pick(o.folder.id)}
            />
          ))}
          {searching && visible.length === 0 && (
            <Text className="px-3 py-4 text-caption text-muted-foreground">No matching folder</Text>
          )}
        </ListGroup>
      </BottomSheetScrollView>

      <View className="mx-3.5 my-1 h-px bg-border" />
      {naming ? (
        <View className="flex-row items-center gap-2 px-3.5 pb-2 pt-1">
          <View className="flex-1">
            <Input
              value={name}
              onChangeText={setName}
              placeholder="Folder name"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={create}
            />
          </View>
          <Button onPress={create} disabled={name.trim() === ''}>
            <Text>Create and move</Text>
          </Button>
        </View>
      ) : (
        <ListItem onPress={() => setNaming(true)} className="mx-1.5" accessibilityRole="button">
          <ListItemLeading>
            <View className="h-7 w-7 items-center justify-center rounded-lg">
              <FolderPlus size={16} className="text-primary" />
            </View>
          </ListItemLeading>
          <ListItemContent>
            <ListItemTitle className="text-primary">New folder</ListItemTitle>
          </ListItemContent>
        </ListItem>
      )}
    </BottomSheet>
  );
}

function DestinationRow({
  name,
  depth,
  path,
  root = false,
  current,
  onPress,
}: {
  name: string;
  depth: number;
  path?: string;
  root?: boolean;
  current: boolean;
  onPress: () => void;
}) {
  const Icon = root ? Files : Folder;
  return (
    <ListItem
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: current }}
      accessibilityLabel={current ? `${name}, current location` : name}
      // Indent carries the tree; capped so a deep branch keeps its names.
      style={{ paddingLeft: 12 + Math.min(depth, 4) * 20 }}
    >
      <ListItemLeading>
        {/* Neutral, like the folder rows: the row is the control and the
            check marks where it is now (H2). */}
        <View className="h-8 w-8 items-center justify-center rounded-xl bg-muted">
          <Icon size={16} className="text-muted-foreground" />
        </View>
      </ListItemLeading>
      <ListItemContent>
        <ListItemTitle>{name}</ListItemTitle>
        {path ? (
          <ListItemMeta>
            <Text className="text-caption text-muted-foreground">{path}</Text>
          </ListItemMeta>
        ) : null}
      </ListItemContent>
      {current && (
        <ListItemTrailing>
          <Check size={16} className="text-primary" />
        </ListItemTrailing>
      )}
    </ListItem>
  );
}

/** How long a filed row takes to leave before the list closes the gap (Hearth MO settle). */
export const ROW_LEAVE_MS = MOTION_DURATIONS_MS.settle;

/**
 * The "filed into a folder" choreography around one list row or folder tile.
 * A row that is leaving shrinks, lifts toward the folders at the top of the
 * list and fades at settle with an ease-in (exits leave quicker than they
 * arrive); the receiving folder tile swells briefly and flashes a neutral wash, so the eye
 * lands where the item went. Transform and opacity only, per Hearth MO, and
 * Reanimated's default ReduceMotion.System makes it instant under reduced
 * motion. The caller owns the timing of the actual data change.
 */
export function MoveMotion({
  leaving,
  receiving,
  className,
  style,
  children,
}: {
  leaving: boolean;
  receiving: boolean;
  /** The row's card-frame classes: the whole slice of the card moves, border included. */
  className?: string;
  /** Static style under the motion (a folder tile's card shadow). */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);
  const lift = useSharedValue(0);
  const wash = useSharedValue(0);

  React.useEffect(() => {
    const exit = { duration: ROW_LEAVE_MS, easing: Easing.in(Easing.quad) };
    if (leaving) {
      opacity.value = withTiming(0, exit);
      scale.value = withTiming(0.92, exit);
      lift.value = withTiming(-16, exit);
    } else {
      // FlashList recycles cells, so a cell that last played an exit must
      // come back whole for whatever row it shows next.
      opacity.value = 1;
      scale.value = 1;
      lift.value = 0;
    }
  }, [leaving, opacity, scale, lift]);

  React.useEffect(() => {
    if (!receiving) return;
    const swiftOut = Easing.bezier(0.16, 1, 0.3, 1);
    scale.value = withSequence(
      withTiming(1.03, { duration: MOTION_DURATIONS_MS.fast, easing: swiftOut }),
      withTiming(1, { duration: MOTION_DURATIONS_MS.base, easing: swiftOut })
    );
    wash.value = withSequence(
      withTiming(1, { duration: MOTION_DURATIONS_MS.fast }),
      withDelay(MOTION_DURATIONS_MS.slow, withTiming(0, { duration: MOTION_DURATIONS_MS.exit }))
    );
  }, [receiving, scale, wash]);

  const rowStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: lift.value }, { scale: scale.value }],
  }));
  const washStyle = useAnimatedStyle(() => ({ opacity: wash.value }));

  return (
    <Animated.View style={[style, rowStyle]} className={cn('overflow-hidden', className)}>
      {/* Behind the row's content and above the frame's fill, so the wash
          tints the row without veiling its text. */}
      <Animated.View pointerEvents="none" style={washStyle} className="absolute inset-0 bg-accent/60" />
      {children}
    </Animated.View>
  );
}

/**
 * Deleting a folder (M4): what happens to the documents inside is an explicit
 * choice. Left off, they go back to All documents; switched on, they are
 * deleted with the folder, and that path asks once more before anything goes.
 */
export function FolderDeleteSheet({
  open,
  onOpenChange,
  folderName,
  documentCount,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderName: string;
  /** Documents in the folder and every folder under it. */
  documentCount: number;
  onDelete: (withDocuments: boolean) => void;
}) {
  const [withDocuments, setWithDocuments] = React.useState(false);

  // Each opening starts with the documents kept.
  React.useEffect(() => {
    if (open) setWithDocuments(false);
  }, [open]);

  const documentsLabel = documentCount === 1 ? '1 document' : `${documentCount} documents`;

  const submit = () => {
    if (!withDocuments || documentCount === 0) {
      onOpenChange(false);
      onDelete(false);
      return;
    }
    dialog.alert(
      `Delete ${folderName} and ${documentsLabel}?`,
      'The documents are deleted for everyone in the household. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete all',
          style: 'destructive',
          onPress: () => {
            onOpenChange(false);
            onDelete(true);
          },
        },
      ]
    );
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <View className="gap-3 px-4 pb-6">
        <View className="gap-0.5 px-1">
          <Text className="text-micro-label uppercase text-muted-foreground">Delete folder</Text>
          <Text className="text-body text-foreground" numberOfLines={1}>
            {folderName}
          </Text>
        </View>
        {documentCount > 0 ? (
          <Pressable
            onPress={() => {
              haptics.select();
              setWithDocuments((v) => !v);
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: withDocuments }}
            className="min-h-11 flex-row items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5"
          >
            <View className="flex-1 gap-0.5">
              <Text className="text-body text-foreground">Delete its {documentsLabel} too</Text>
              <Text className="text-caption text-muted-foreground">
                {withDocuments ? 'They are deleted along with the folder.' : 'Left off, they move back to All documents.'}
              </Text>
            </View>
            <Switch checked={withDocuments} onChange={setWithDocuments} label={`Delete its ${documentsLabel} too`} />
          </Pressable>
        ) : (
          <Text className="px-1 text-caption text-muted-foreground">This folder has no documents in it.</Text>
        )}
        {/* E4: destructive is danger text, never a fill. */}
        <Button variant="outline" onPress={submit} textClassName="text-destructive">
          {withDocuments && documentCount > 0 ? `Delete folder and ${documentsLabel}` : 'Delete folder'}
        </Button>
      </View>
    </BottomSheet>
  );
}
