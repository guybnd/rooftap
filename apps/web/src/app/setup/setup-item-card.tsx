'use client';

import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import {
  STATUS_ORDER,
  PRIORITY_ORDER,
  PRIORITY_LABEL,
  nextStatus,
  type SetupItem,
  type SetupStore,
  SETUP_STATUS_LABEL,
  currencySymbol,
} from '@homeup/core';
import { dialog } from '@homeup/core';
import {
  ExternalLink,
  MessageSquare,
  FileText,
  MoreVertical,
  ChevronsUp,
  ChevronsDown,
  Equal,
  Store,
  Trash2,
  Pencil,
  Check,
  CheckCircle2,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import { EditableText } from '@/components/ui/editable-text';
import {
  ListItem,
  ListItemLeading,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
  ListItemBody,
} from '@/components/ui/list-item';
import { PortalChipRow, type PortalChipDef } from '@/components/ui/portal-chip';
import { SwipeActions } from '@/components/ui/swipe-actions';
import { SetupItemComments } from '@/components/setup-item-comments';
import { StoreSelect } from '@/components/store-select';
import { signedDocumentUrl, documentBucket, SIGNED_URL_TTL_SECONDS } from '@/lib/documents';
import type { DocumentSource } from '@homeup/core';
import { PopMenu, MenuItem, MenuLabel, MenuDivider } from './pop-menu';
import { STATUS_FILL } from './setup-status';
import { useLongPress as useSharedLongPress, HOLD_FILL_DELAY_MS } from '@/hooks/use-long-press';

// FLUX-198: elements that own their own pointer interaction never start a hold
// (mirrors groceries' NO_HOLD — buttons/inputs/links/the inline editors).
const NO_HOLD = 'button, input, textarea, select, a, label, [data-no-swipe]';

// FLUX-198/271: thin wrapper over the shared useLongPress. Hold opens the same
// full edit modal as the "Edit item" menu entry below.
function useRowLongPress(onFire: () => void) {
  const { handlers: shared, consumeClick, progress } = useSharedLongPress(onFire, true, {
    trackProgress: true,
    fillDelayMs: HOLD_FILL_DELAY_MS,
    moveCancelRatio: 0.1,
  });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return; // desktop: existing hover buttons instead of hold
    if ((e.target as HTMLElement).closest(NO_HOLD)) return;
    shared.onPointerDown(e);
  }, [shared]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(NO_HOLD)) return;
    e.preventDefault();
    onFire();
  }, [onFire]);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (consumeClick()) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [consumeClick]);

  return {
    progress,
    handlers: { onPointerDown, onContextMenu, onClickCapture },
  };
}

// Jira-style priority glyphs — direction + colour carry the meaning at a glance.
// Colours mirror PrioritySlider's ACTIVE_COLOR (src/components/ui/priority-slider.tsx).
const PRIORITY_META: Record<string, { Icon: LucideIcon; className: string }> = {
  high: { Icon: ChevronsUp, className: 'text-destructive' },
  medium: { Icon: Equal, className: 'text-warning' },
  low: { Icon: ChevronsDown, className: 'text-muted-foreground' },
};

export interface CommentSummary {
  count: number;
  latest: { content: string; user_id: string; created_at: string } | null;
}

/** A document linked to this setup item (FLUX-132: replaces the warranty link). */
export interface SetupDocLink {
  storagePath: string;
  source: DocumentSource;
}

interface SetupItemCardProps {
  item: SetupItem;
  commentSummary?: CommentSummary;
  docLink?: SetupDocLink;
  groupId: string;
  stores: SetupStore[];
  /** Leading slot — drag handle normally, a select checkbox in bulk mode. */
  dragHandle?: React.ReactNode;
  selected?: boolean;
  onUpdate: (item: SetupItem) => void;
  onDelete: (itemId: string) => void;
  onEdit: (item: SetupItem) => void;
  onCommentsChanged?: () => void;
  onStoreCreated?: (store: SetupStore) => void;
}

export function SetupItemCard({
  item,
  commentSummary,
  docLink,
  groupId,
  stores,
  dragHandle,
  selected,
  onUpdate,
  onDelete,
  onEdit,
  onCommentsChanged,
  onStoreCreated,
}: SetupItemCardProps) {
  const [showComments, setShowComments] = useState(false);
  const [justChanged, setJustChanged] = useState(false);

  // Flash the checkbox briefly when status changes for clear confirmation
  const flashChange = () => {
    setJustChanged(true);
    setTimeout(() => setJustChanged(false), 600);
  };

  // All inline edits route through the Legend store (onUpdate → patchRow,
  // onDelete → softDeleteRow). These write to IndexedDB and sync when online,
  // so they work offline. A direct supabase.update()/.delete() here throws
  // offline ("Failed to update …: {}") and bypasses the local-first store.
  const handleStatusChange = (newStatus: string) => {
    if (newStatus === item.status) return;
    onUpdate({ ...item, status: newStatus } as SetupItem);
    flashChange();
  };

  const handlePriorityChange = (newPriority: string) => {
    if (newPriority === item.priority) return;
    onUpdate({ ...item, priority: newPriority } as SetupItem);
  };

  const handleFieldChange = (field: string, value: string) => {
    const payload: Record<string, unknown> = {};
    if (field === 'name') payload.name = value;
    else if (field === 'est_price') payload.est_price = value ? parseInt(value, 10) : null;
    else if (field === 'actual_price') payload.actual_price = value ? parseInt(value, 10) : null;
    else if (field === 'where_to_buy') payload.where_to_buy = value;
    else if (field === 'url') payload.url = value || null;
    onUpdate({ ...item, ...payload } as SetupItem);
  };

  const handleDelete = async () => {
    if (!(await dialog.confirm({ title: `Delete "${item.name}"?`, destructive: true }))) return;
    onDelete(item.id);
  };

  const handleStoreChange = (storeId: string | null) => {
    onUpdate({ ...item, store_id: storeId } as SetupItem);
  };

  const openDoc = async () => {
    if (!docLink) return;
    const supabase = createClient();
    const url = await signedDocumentUrl(supabase, docLink.storagePath, SIGNED_URL_TTL_SECONDS, documentBucket(docLink.source));
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openLink = () => {
    if (!item.url) return;
    window.open(item.url, '_blank', 'noopener,noreferrer');
  };

  const store = stores.find((s) => s.id === item.store_id) ?? null;

  const renderInlineEdit = (
    field: 'name' | 'est_price' | 'actual_price',
    value: string | number | null,
    type = 'text',
    compact = false,
    display?: React.ReactNode
  ) => (
    <EditableText
      value={String(value ?? '')}
      onCommit={(v) => handleFieldChange(field, v)}
      type={type}
      triggerClassName="hover:text-primary transition-colors"
      inputClassName={cn(
        'bg-muted border border-input rounded px-2 py-0.5 text-foreground',
        compact ? 'text-xs w-20' : 'text-sm w-full'
      )}
      triggerTitle="Click to edit"
    >
      {display ?? value ?? '-'}
    </EditableText>
  );

  const commentCount = commentSummary?.count ?? 0;

  // Over/under-budget delta, only when both prices are known.
  const delta =
    item.est_price != null && item.actual_price != null ? item.actual_price - item.est_price : null;

  const isInstalled = item.status === 'installed';
  const advanceStatus = () => {
    handleStatusChange(nextStatus(item.status));
  };

  const longPress = useRowLongPress(() => onEdit(item));

  // Purchase-list framing (installed/needed), not a done/delete binary — the
  // leading checkbox and the Status entries in the overflow menu below remain
  // the always-visible alternate ways to reach these same two states
  // (FLUX-198/210 guardrail).
  const swipeRight = () => handleStatusChange('installed');
  const swipeLeft = () => handleStatusChange('needed');

  // Hearth §6 portal contract: comments (opens in place), product link + linked
  // document (leave the section) — max three, so no overflow chip is needed here.
  // PC7: an empty thread prints nothing (it would cost every row a line);
  // the overflow menu's Comments row is how the first one gets added.
  const portalChips: PortalChipDef[] = [];
  if (commentCount > 0 || showComments) {
    portalChips.push({
      key: 'comments',
      icon: <MessageSquare className="h-3.5 w-3.5" />,
      // PC: the chip names the noun it opens ("2 comments").
      label: commentCount > 0 ? `${commentCount} comment${commentCount === 1 ? '' : 's'}` : 'Comments',
      tone: 'neutral',
      onOpen: () => setShowComments((v) => !v),
    });
  }
  if (item.url) {
    portalChips.push({
      key: 'link',
      icon: <ExternalLink className="h-3.5 w-3.5" />,
      label: 'Link',
      tone: 'accent',
      onOpen: openLink,
    });
  }
  if (docLink) {
    portalChips.push({
      key: 'doc',
      icon: <FileText className="h-3.5 w-3.5" />,
      label: 'Doc',
      tone: 'accent',
      onOpen: openDoc,
    });
  }

  return (
    <div>
      <SwipeActions
        onSwipeRight={swipeRight}
        onSwipeLeft={swipeLeft}
        right={{ bg: 'bg-success/70', activeBg: 'bg-success', icon: <CheckCircle2 className="h-5 w-5 text-white" />, label: SETUP_STATUS_LABEL.installed }}
        // H2: back to "needed" is an undo, not a danger state, so it reveals neutral.
        left={{ bg: 'bg-muted-foreground/50', activeBg: 'bg-muted-foreground', icon: <RotateCcw className="h-5 w-5 text-white" />, label: SETUP_STATUS_LABEL.needed }}
      >
      <ListItem
        expanded={showComments}
        holdProgress={longPress.progress}
        {...longPress.handlers}
        className={cn(
          'items-center gap-3 py-2.5 pr-3 pl-4 transition-colors select-none [-webkit-touch-callout:none]',
          'bg-card hover:bg-accent/50',
          // Done (Hearth §6): the row's content fades to 55%, not the row
          // itself, so its fill stays opaque over the swipe reveals beneath.
          isInstalled && '[&>[data-slot]]:opacity-55',
          // Inset (not outset) so the selection ring stays inside SwipeActions'
          // overflow-hidden clip mask instead of getting cut off at its edges.
          selected && 'ring-1 ring-inset ring-primary/60'
        )}
      >
        <ListItemLeading className="gap-2">
          {/* Setup item tenant: square checkbox toggles installed/needed
              (Hearth §6 tenant matrix). Same two states as the swipe gesture
              and the Status entries in the overflow menu. A bought item swaps
              it for a filled check on the same footprint (Done state, as on
              Tasks), so toggling causes no layout shift. The label pads the
              16px box out to a ~40px target. In select or reorder mode the
              slot holds that mode's control alone (a selection mark, or the
              drag handle), as on mobile, not a second box beside this one. */}
          {dragHandle ?? (
            <label
              className={cn(
                '-m-3 flex cursor-pointer items-center justify-center rounded-sm p-3 transition-shadow',
                justChanged && '[&>*]:ring-2 [&>*]:ring-ring/40'
              )}
            >
              {isInstalled ? (
                <button
                  type="button"
                  onClick={advanceStatus}
                  className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px] bg-success text-success-foreground"
                  aria-label="Mark as still needed"
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </button>
              ) : (
                <input
                  type="checkbox"
                  checked={false}
                  onChange={advanceStatus}
                  className="h-4 w-4 flex-shrink-0 cursor-pointer rounded-[4px] accent-primary"
                  aria-label="Mark as got it"
                />
              )}
            </label>
          )}
        </ListItemLeading>

        <ListItemContent>
          <ListItemTitle
            className={cn(isInstalled && 'text-muted-foreground line-through decoration-muted-foreground/60')}
          >
            {renderInlineEdit('name', item.name)}
          </ListItemTitle>

          <ListItemMeta>
            {/* Priority — tinted word, never a filled pill (H6). Tap opens the
                same priority picker the old leading chevron did. */}
            <PopMenu
              align="left"
              width="w-32"
              triggerLabel={`Priority: ${PRIORITY_LABEL[item.priority]}`}
              triggerClassName={cn(
                'font-medium flex-shrink-0 transition-colors hover:underline underline-offset-2',
                PRIORITY_META[item.priority].className
              )}
              trigger={PRIORITY_LABEL[item.priority]}
            >
              {(close) => (
                <>
                  <MenuLabel>Priority</MenuLabel>
                  {PRIORITY_ORDER.map((p) => {
                    const { Icon, className } = PRIORITY_META[p];
                    return (
                      <MenuItem
                        key={p}
                        active={item.priority === p}
                        icon={<Icon className={`h-4 w-4 ${className}`} />}
                        onClick={() => {
                          handlePriorityChange(p);
                          close();
                        }}
                      >
                        {PRIORITY_LABEL[p]}
                      </MenuItem>
                    );
                  })}
                </>
              )}
            </PopMenu>

            <span aria-hidden className="text-muted-foreground/50">·</span>

            {/* Store selector (entity-based). The store's own site moved to the
                overflow menu ("Visit store"): no inline action icons in rows. */}
            <span className="flex min-w-0 items-center gap-1">
              <Store className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              <StoreSelect
                groupId={groupId}
                value={item.store_id}
                stores={stores}
                onChange={handleStoreChange}
                onStoreCreated={onStoreCreated}
              />
            </span>

            {/* What it actually cost sits on its own line, so the dot grammar
                above never dangles at a wrap. The amount is plain; only the
                delta against the estimate carries a state hue (H2). */}
            {item.actual_price != null && (
              <span className="basis-full tabular-nums">
                <span>Paid </span>
                <span className="font-medium text-foreground">
                  ${renderInlineEdit('actual_price', item.actual_price, 'number', true, item.actual_price.toLocaleString())}
                </span>
                {delta != null && delta !== 0 && (
                  <span className={cn('ml-1.5 font-medium', delta < 0 ? 'text-success' : 'text-warning')}>
                    {delta < 0 ? '\u2212' : '+'}${Math.abs(delta).toLocaleString()}
                  </span>
                )}
              </span>
            )}
          </ListItemMeta>

          <PortalChipRow chips={portalChips} className="mt-0.5" />
        </ListItemContent>

        <ListItemTrailing className="gap-2">
          <span className="flex-shrink-0 text-sm tabular-nums">
            <span className="text-muted-foreground text-xs">Est </span>
            <span className="text-foreground font-medium">
              {item.est_price != null && currencySymbol()}
              {renderInlineEdit('est_price', item.est_price, 'number', true, item.est_price?.toLocaleString())}
            </span>
          </span>

          {/* Overflow — extends the Status picker with Edit / Link / Delete
              (FLUX-271: consolidated here rather than always-visible icons). */}
          <PopMenu
            align="right"
            width="w-44"
            triggerLabel="More actions"
            triggerClassName="-mr-1.5 flex items-center justify-center h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
            trigger={<MoreVertical className="h-4 w-4" />}
          >
            {(close) => (
              <>
                <MenuLabel>Status</MenuLabel>
                {STATUS_ORDER.map((s) => (
                  <MenuItem
                    key={s}
                    active={item.status === s}
                    icon={<span className={`h-2.5 w-2.5 rounded-full ${STATUS_FILL[s]}`} />}
                    onClick={() => {
                      handleStatusChange(s);
                      close();
                    }}
                  >
                    {SETUP_STATUS_LABEL[s]}
                  </MenuItem>
                ))}

                <MenuDivider />

                <MenuItem
                  icon={<Pencil className="h-4 w-4" />}
                  onClick={() => {
                    onEdit(item);
                    close();
                  }}
                >
                  Edit item
                </MenuItem>

                <MenuItem
                  icon={<MessageSquare className="h-4 w-4" />}
                  onClick={() => {
                    setShowComments(true);
                    close();
                  }}
                  trailing={
                    <span className="text-xs font-medium tabular-nums text-muted-foreground">
                      {commentCount > 0 ? commentCount : 'Add'}
                    </span>
                  }
                >
                  Comments
                </MenuItem>

                <MenuItem
                  icon={<ExternalLink className="h-4 w-4" />}
                  onClick={() => {
                    if (item.url) openLink();
                    else onEdit(item); // no link yet — the URL field lives in the full editor
                    close();
                  }}
                >
                  {item.url ? 'Open link' : 'Add link'}
                </MenuItem>

                {store?.url && (
                  <MenuItem
                    icon={<Store className="h-4 w-4" />}
                    onClick={() => {
                      window.open(store.url as string, '_blank', 'noopener,noreferrer');
                      close();
                    }}
                  >
                    Visit store
                  </MenuItem>
                )}

                <MenuDivider />

                <MenuItem
                  danger
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => {
                    handleDelete();
                    close();
                  }}
                >
                  Delete
                </MenuItem>
              </>
            )}
          </PopMenu>
        </ListItemTrailing>
      </ListItem>
      </SwipeActions>

      {/* Comments section (expandable) — opened in place from the Comments portal chip */}
      {showComments && (
        <ListItemBody expanded={showComments}>
          <SetupItemComments itemId={item.id} onChanged={onCommentsChanged} />
        </ListItemBody>
      )}
    </div>
  );
}
