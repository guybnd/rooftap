// HOUP-88: native setup item row. Port of the disposition + portal-chip
// logic from apps/web/src/app/setup/setup-item-card.tsx: swipe right ->
// installed ("Got it"), swipe left -> needed. Web's PopMenu-driven inline
// field editing (priority picker, store select, EditableText price/name) is
// dropped — native routes every edit through the item editor sheet
// (Checklists/Costs idiom); priority and store show as plain meta text here.
// The overflow "More actions" trigger replaces PopMenu with a BottomSheet
// action sheet (Set status / Edit / Open link / Move up-down / Delete).
import * as React from 'react';
import { Linking, Pressable, View } from 'react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  Text,
  BottomSheet,
  EditableText,
  EntityComments,
  ListGroup,
  ListItem,
  ListItemLeading,
  ListItemContent,
  ListItemBody,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
  PortalChipRow,
  SwipeActions,
  cn,
  haptics,
  useHoldFill,
  type PortalChipDef,
} from '@homeup/ui';
import {
  Check,
  CheckCircle2,
  ChevronsDown,
  ChevronsUp,
  Equal,
  ExternalLink,
  FileText,
  GripVertical,
  MessageSquare,
  MoreVertical,
  Pencil,
  RotateCcw,
  Sparkles,
  Store as StoreIcon,
  Trash2,
  type LucideIcon,
} from 'lucide-react-native';
import {
  STATUS_ORDER,
  PRIORITY_LABEL,
  nextStatus,
  documentBucket,
  type SetupItem,
  type SetupStore,
  SETUP_STATUS_LABEL,
  currencySymbol,
  scoutPrefillFromSetupItem,
  scoutPrefillHref,
  setupCommentChipLabel,
  setupPriceDelta,
  setupPriceEdit,
  useModules,
} from '@homeup/core';
import { openDocumentExternally } from '@/components/documents/document-preview';
import { useOpenRoute } from '@/lib/tab-routes';
import { STATUS_FILL } from './setup-status';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

// HOUP-198: matches task-row.tsx's hold-to-edit timing (HOUP-144).
const LONG_PRESS_MS = 500;

const PRIORITY_META: Record<string, { Icon: LucideIcon; className: string }> = {
  high: { Icon: ChevronsUp, className: 'text-destructive' },
  medium: { Icon: Equal, className: 'text-warning' },
  low: { Icon: ChevronsDown, className: 'text-muted-foreground' },
};

import type { SetupDocLink } from '@homeup/core';
export type { SetupDocLink };

interface SetupItemCardProps {
  item: SetupItem;
  stores: SetupStore[];
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (itemId: string) => void;
  onStatusChange: (item: SetupItem, status: SetupItem['status']) => void;
  /** HOUP-187: inline est/actual price edits (tap-to-edit via EditableText). */
  onPatch: (itemId: string, patch: Partial<SetupItem>) => void;
  onDelete: (itemId: string) => void;
  onEdit: (item: SetupItem) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** HOUP-129: renders the leading slot as a drag handle and suppresses tap-to-edit/swipe/kebab. Mutually exclusive with selectMode. */
  reorderMode?: boolean;
  /** HOUP-129: true while this row is the one currently being dragged (from `ReorderableList`'s renderItem). */
  dragging?: boolean;
  /** HOUP-174: comment count for the Comments portal chip label (fetched by the screen). */
  commentCount?: number;
  /** HOUP-174: linked document for the Doc portal chip, if any (fetched by the screen). */
  docLink?: SetupDocLink;
  /** HOUP-174: refetch comment counts after a comment is added/removed in the expanded panel. */
  onCommentsChanged?: () => void;
  /** HOUP-128: Supabase client for the Comments portal chip's read/write. */
  supabase: SupabaseClient;
  currentUserId: string | null;
  memberProfiles: MemberProfiles;
}

export function SetupItemCard({
  item,
  stores,
  selectMode,
  selected,
  onToggleSelect,
  onStatusChange,
  onPatch,
  onDelete,
  onEdit,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  reorderMode,
  dragging,
  commentCount = 0,
  docLink,
  onCommentsChanged,
  supabase,
  currentUserId,
  memberProfiles,
}: SetupItemCardProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const openRoute = useOpenRoute();
  const modules = useModules();
  // Shopper's Scout can research a still-needed item. Hidden when Shopper is
  // off or the server has no Scout tables; the brief sheet itself explains a
  // plan without AI.
  const canScout = item.status === 'needed' && modules.isEnabled('shopper') && modules.server('shopper.scout');
  const [showComments, setShowComments] = React.useState(false);
  // HOUP-198: hold-to-edit arming fill — wired through SwipeActions' onLongPress
  // (see swipe-actions.tsx header comment for why a bare ListItem.onLongPress
  // never reliably fires here, nested inside SwipeActions' Pan GestureDetector).
  const holdFill = useHoldFill(LONG_PRESS_MS);

  const isInstalled = item.status === 'installed';
  const store = stores.find((s) => s.id === item.store_id) ?? null;
  const priorityMeta = PRIORITY_META[item.priority];

  const delta = setupPriceDelta(item);

  const openLink = () => {
    if (item.url) void Linking.openURL(item.url);
  };

  const openDoc = () => {
    if (!docLink) return;
    void openDocumentExternally(supabase, docLink.storagePath, documentBucket(docLink.source));
  };

  // HOUP-187: tap-to-edit est/actual price inline (mirrors web's
  // renderInlineEdit('est_price'|'actual_price', ..., 'number') in
  // apps/web/src/app/setup/setup-item-card.tsx) — empty commits null, an
  // unchanged value is a no-op.
  const commitPrice = (field: 'est_price' | 'actual_price', v: string) => {
    const next = setupPriceEdit(item[field], v);
    if (next !== undefined) onPatch(item.id, { [field]: next });
  };

  // Hearth §6 portal contract: comments (opens in place), product link + linked
  // document (leave the section) — max three, matching the web card.
  // PC7: an empty thread prints nothing (it would cost every row a line);
  // the hold menu's Comments row is how the first one gets added. Mirrors web.
  const portalChips: PortalChipDef[] = [];
  if (commentCount > 0 || showComments) {
    portalChips.push({
      key: 'comments',
      icon: <MessageSquare size={13} className="text-muted-foreground" />,
      // PC: the chip names the noun it opens ("2 comments").
      label: setupCommentChipLabel(commentCount),
      tone: 'neutral',
      onOpen: () => setShowComments((v) => !v),
    });
  }
  if (item.url) {
    portalChips.push({ key: 'link', icon: <ExternalLink size={13} className="text-primary" />, label: 'Link', tone: 'accent', onOpen: openLink });
  }
  if (docLink) {
    portalChips.push({ key: 'doc', icon: <FileText size={13} className="text-primary" />, label: 'Doc', tone: 'accent', onOpen: openDoc });
  }

  const metaParts: string[] = [];
  if (store) metaParts.push(store.name);

  const row = (
    <ListItem
      onPress={reorderMode ? undefined : () => (selectMode ? onToggleSelect?.(item.id) : onEdit(item))}
      // Normal mode's long-press now goes through SwipeActions' onLongPress
      // below; select/reorder mode bypasses SwipeActions entirely (no Pan to
      // conflict with), so selectMode keeps a direct ListItem.onLongPress.
      onLongPress={reorderMode ? undefined : selectMode ? () => onEdit(item) : undefined}
      holdProgress={!selectMode && !reorderMode ? holdFill.progress : undefined}
      // Done (Hearth §6): 55% + strikethrough + check, as on Tasks; mirrors web.
      className={cn(dragging && 'bg-accent/30', isInstalled && 'opacity-[0.55]')}
    >
      <ListItemLeading>
        {reorderMode ? (
          <GripVertical size={16} className="text-muted-foreground" />
        ) : selectMode ? (
          <View className={cn('h-5 w-5 items-center justify-center rounded-full border-2', selected ? 'border-primary bg-primary' : 'border-border')}>
            {selected && <Check size={12} className="text-primary-foreground" />}
          </View>
        ) : (
          <Pressable
            onPress={() => onStatusChange(item, nextStatus(item.status))}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isInstalled }}
            accessibilityLabel={isInstalled ? 'Mark as still needed' : 'Mark as got it'}
            hitSlop={8}
            className={cn('h-5 w-5 items-center justify-center rounded-sm border', isInstalled ? cn('border-success', STATUS_FILL.installed) : 'border-border')}
          >
            {isInstalled && <Check size={12} className="text-success-foreground" />}
          </Pressable>
        )}
      </ListItemLeading>

      <ListItemContent>
        <ListItemTitle className={cn(isInstalled && 'text-muted-foreground line-through')}>{item.name}</ListItemTitle>

        <ListItemMeta>
          <View className="flex-row items-center gap-1">
            <priorityMeta.Icon size={12} className={priorityMeta.className} />
            <Text className={cn('text-caption font-medium', priorityMeta.className)}>{PRIORITY_LABEL[item.priority]}</Text>
          </View>
          {metaParts.length > 0 && (
            <View className="flex-row items-center gap-1">
              <StoreIcon size={11} className="text-muted-foreground" />
              <Text className="text-caption text-muted-foreground">{metaParts.join(' · ')}</Text>
            </View>
          )}
        </ListItemMeta>

        {/* What it actually cost sits on its own line, outside the dotted
            meta, so the dot grammar never dangles at a wrap. The amount is
            plain; only the delta against the estimate carries a state hue
            (H2). Mirrors web. */}
        {item.actual_price != null && (
          // HOUP-187: a View (not one nested-Text run) so EditableText's
          // Pressable/TextInput can sit inline between the "Paid" label and
          // the delta — RN Text can't host a View/Pressable child.
          <View className="flex-row items-center">
            <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>Paid </Text>
            {reorderMode || selectMode ? (
              <Text className="text-caption font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                ${item.actual_price.toLocaleString()}
              </Text>
            ) : (
              <EditableText
                value={String(item.actual_price)}
                onCommit={(v) => commitPrice('actual_price', v)}
                keyboardType="numeric"
              >
                <Text className="text-caption font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                  ${item.actual_price.toLocaleString()}
                </Text>
              </EditableText>
            )}
            {delta != null && delta !== 0 && (
              <Text className={cn('text-caption font-medium', delta < 0 ? 'text-success' : 'text-warning')} style={{ fontVariant: ['tabular-nums'] }}>
                {' '}
                {delta < 0 ? '\u2212' : '+'}${Math.abs(delta).toLocaleString()}
              </Text>
            )}
          </View>
        )}

        {portalChips.length > 0 && (
          <View pointerEvents={reorderMode ? 'none' : 'auto'} className={cn(reorderMode && 'opacity-50')}>
            <PortalChipRow chips={portalChips} className="mt-1.5" />
          </View>
        )}
      </ListItemContent>

      <ListItemTrailing className="gap-2">
        <View className="flex-row items-center">
          <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>Est </Text>
          {reorderMode || selectMode ? (
            <Text className="text-body font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {item.est_price != null ? `${currencySymbol()}${item.est_price.toLocaleString()}` : '-'}
            </Text>
          ) : (
            <EditableText
              value={item.est_price != null ? String(item.est_price) : ''}
              onCommit={(v) => commitPrice('est_price', v)}
              keyboardType="numeric"
              placeholder="-"
            >
              <Text className="text-body font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {item.est_price != null ? `${currencySymbol()}${item.est_price.toLocaleString()}` : '-'}
              </Text>
            </EditableText>
          )}
        </View>
        {!selectMode && !reorderMode && (
          <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} accessibilityLabel="More actions">
            <MoreVertical size={16} className="text-muted-foreground" />
          </Pressable>
        )}
      </ListItemTrailing>
    </ListItem>
  );

  return (
    <View>
      {selectMode || reorderMode ? (
        row
      ) : (
        <SwipeActions
          onSwipeRight={() => onStatusChange(item, 'installed')}
          onSwipeLeft={() => onStatusChange(item, 'needed')}
          right={{ bg: 'bg-success/15', activeBg: 'bg-success', icon: <CheckCircle2 size={18} className="text-success" />, label: SETUP_STATUS_LABEL.installed }}
          // H2: back to "needed" is an undo, not a danger state, so it reveals neutral (mirrors web).
          left={{ bg: 'bg-muted', activeBg: 'bg-muted-foreground/40', icon: <RotateCcw size={18} className="text-muted-foreground" />, label: SETUP_STATUS_LABEL.needed }}
          longPressMs={LONG_PRESS_MS}
          onLongPress={() => { haptics.commit(); onEdit(item); }}
          onHoldStart={holdFill.start}
          onHoldEnd={holdFill.stop}
        >
          {row}
        </SwipeActions>
      )}

      {showComments && (
        <ListItemBody expanded={showComments}>
          <EntityComments
            table="setup_item_comments"
            fkColumn="setup_item_id"
            entityId={item.id}
            supabase={supabase}
            currentUserId={currentUserId}
            memberProfiles={memberProfiles}
            onChanged={onCommentsChanged}
          />
        </ListItemBody>
      )}

      <BottomSheet open={menuOpen} onOpenChange={setMenuOpen} className="max-h-[70%] pb-2">
        <ListGroup className="mx-1.5 mt-1.5 border-0 bg-transparent">
          {STATUS_ORDER.map((s) => (
            <ListItem
              key={s}
              onPress={() => {
                onStatusChange(item, s);
                setMenuOpen(false);
              }}
            >
              <ListItemLeading>
                <View className={cn('h-2.5 w-2.5 rounded-full', STATUS_FILL[s])} />
              </ListItemLeading>
              <ListItemContent>
                <ListItemTitle className={cn(item.status === s && 'text-primary')}>{SETUP_STATUS_LABEL[s]}</ListItemTitle>
              </ListItemContent>
            </ListItem>
          ))}
          <ListItem
            onPress={() => {
              onEdit(item);
              setMenuOpen(false);
            }}
          >
            <ListItemLeading>
              <Pencil size={16} className="text-muted-foreground" />
            </ListItemLeading>
            <ListItemContent>
              <ListItemTitle>Edit item</ListItemTitle>
            </ListItemContent>
          </ListItem>
          <ListItem
            onPress={() => {
              setShowComments(true);
              setMenuOpen(false);
            }}
          >
            <ListItemLeading>
              <MessageSquare size={16} className="text-muted-foreground" />
            </ListItemLeading>
            <ListItemContent>
              <ListItemTitle>Comments</ListItemTitle>
            </ListItemContent>
            <ListItemTrailing>
              <Text className="text-xs font-medium text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {commentCount > 0 ? String(commentCount) : 'Add'}
              </Text>
            </ListItemTrailing>
          </ListItem>
          <ListItem
            onPress={() => {
              if (item.url) openLink();
              else onEdit(item);
              setMenuOpen(false);
            }}
          >
            <ListItemLeading>
              <ExternalLink size={16} className="text-muted-foreground" />
            </ListItemLeading>
            <ListItemContent>
              <ListItemTitle>{item.url ? 'Open link' : 'Add link'}</ListItemTitle>
            </ListItemContent>
          </ListItem>
          {canScout ? (
            <ListItem
              onPress={() => {
                setMenuOpen(false);
                openRoute(scoutPrefillHref(scoutPrefillFromSetupItem(item)));
              }}
            >
              <ListItemLeading>
                <Sparkles size={16} className="text-muted-foreground" />
              </ListItemLeading>
              <ListItemContent>
                <ListItemTitle>Find with Scout</ListItemTitle>
              </ListItemContent>
            </ListItem>
          ) : null}
          {store?.url ? (
            <ListItem
              onPress={() => {
                void Linking.openURL(store.url as string);
                setMenuOpen(false);
              }}
            >
              <ListItemLeading>
                <StoreIcon size={16} className="text-muted-foreground" />
              </ListItemLeading>
              <ListItemContent>
                <ListItemTitle>Visit store</ListItemTitle>
              </ListItemContent>
            </ListItem>
          ) : null}
          {onMoveUp && (
            <ListItem
              disabled={!canMoveUp}
              onPress={() => {
                onMoveUp();
                setMenuOpen(false);
              }}
            >
              <ListItemContent>
                <ListItemTitle className={cn(!canMoveUp && 'text-muted-foreground')}>Move up</ListItemTitle>
              </ListItemContent>
            </ListItem>
          )}
          {onMoveDown && (
            <ListItem
              disabled={!canMoveDown}
              onPress={() => {
                onMoveDown();
                setMenuOpen(false);
              }}
            >
              <ListItemContent>
                <ListItemTitle className={cn(!canMoveDown && 'text-muted-foreground')}>Move down</ListItemTitle>
              </ListItemContent>
            </ListItem>
          )}
          <ListItem
            onPress={() => {
              setMenuOpen(false);
              onDelete(item.id);
            }}
          >
            <ListItemLeading>
              <Trash2 size={16} className="text-destructive" />
            </ListItemLeading>
            <ListItemContent>
              <ListItemTitle className="text-destructive">Delete</ListItemTitle>
            </ListItemContent>
          </ListItem>
        </ListGroup>
      </BottomSheet>
    </View>
  );
}
