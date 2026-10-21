// HOUP-332: the ONE native item-list primitive — resting item rows (checkbox,
// tap-to-rename/re-price, swipe-right toggle / swipe-left delete), the fast
// add well (HOUP-329: multi-line paste, duplicate nudge, keep-focus-after-add),
// and the Completed band fold (HOUP-327). Used by BOTH the checklist detail
// screen (`variant="detail"`) and the /tasks + home-hero inline panel
// (`variant="inline"`) so resting item-row markup exists in exactly one place.
//
// Deliberately NOT here (stays screen-owned, detail-only): the sort-mode menu,
// bulk actions (Check/Uncheck all, Clear completed), reorder mode (native's
// drag-to-reorder ReorderableList), list settings, delete-list. `variant`
// otherwise only changes density/inset styling and whether the trailing
// `done / total` + "Open full checklist" line renders (inline only — detail
// already shows that in its own header card above this list).
import * as React from 'react';
import { Pressable, View, type TextInput } from 'react-native';
import { Check, ChevronDown, ChevronRight, Plus, RotateCcw, Trash2 } from 'lucide-react-native';
import {
  completion,
  findDuplicateLabel,
  splitPastedIntoField,
  centsToDollars,
  dollarsToCents,
  sortItems,
  partitionDone,
  type Checklist,
  type ChecklistSortMode,
  type ChecklistTaskItem,
  formatPastDay,
  currencySymbol,
} from '@homeup/core';
import { cn } from '../lib/cn';
import { commit, tick } from '../lib/haptics';
import { Text } from './text';
import { Button } from './button';
import { Input } from './input';
import { EditableText } from './editable-text';
import { ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle } from './list-item';
import { SwipeActions, type SwipeConfig } from './swipe-actions';

const DONE_CFG: SwipeConfig = { bg: 'bg-success/15', activeBg: 'bg-success', icon: <Check size={18} className="text-success-foreground" />, label: 'Done' };
const UNCHECK_CFG: SwipeConfig = { bg: 'bg-muted-foreground/15', activeBg: 'bg-muted-foreground', icon: <RotateCcw size={18} className="text-background" />, label: 'Uncheck' };
const DELETE_CFG: SwipeConfig = { bg: 'bg-destructive/15', activeBg: 'bg-destructive', icon: <Trash2 size={18} className="text-white" />, label: 'Delete' };

export interface ChecklistItemListViewPrefs {
  sortMode: ChecklistSortMode;
  completedToBottom: boolean;
  collapsed: boolean;
  setCollapsed: (on: boolean) => void;
}

export interface ChecklistItemListProps {
  checklist: Checklist;
  /** The flat, order-ascending, unpartitioned array (D7) — never a sorted view. */
  orderedItems: ChecklistTaskItem[];
  viewPrefs: ChecklistItemListViewPrefs;
  variant: 'detail' | 'inline';
  onToggle: (item: ChecklistTaskItem) => void;
  onAdd: (labels: string[], opts?: { costCents?: number | null }) => ChecklistTaskItem[];
  onRename: (item: ChecklistTaskItem, label: string) => void;
  onReprice: (item: ChecklistTaskItem, dollars: string) => void;
  onDelete: (item: ChecklistTaskItem) => void;
  /** Open the full checklist detail screen — inline variant only. */
  onOpenFull?: () => void;
  /** Focus the add well's label input once, on mount (quick-menu create flow). */
  autoFocusAdd?: boolean;
}

export interface ChecklistAddWellProps {
  checklist: Checklist;
  onAdd: (labels: string[], opts?: { costCents?: number | null }) => ChecklistTaskItem[];
  /** Focus the add well's label input once, on mount (quick-menu create flow). */
  autoFocusAdd?: boolean;
  /** The flat, order-ascending, unpartitioned array (D7) — used for duplicate-label detection only. */
  orderedItems: ChecklistTaskItem[];
}

/**
 * The add well, split out of `ChecklistItemList` so a screen can render it
 * standalone alongside a substitute row list (HOUP-332: the native detail
 * screen's drag-to-reorder `ReorderableList` swaps out `ChecklistItemList`
 * entirely, and without this the add well disappeared with it).
 */
export function ChecklistAddWell({ checklist, onAdd, autoFocusAdd, orderedItems }: ChecklistAddWellProps) {
  const [newLabel, setNewLabel] = React.useState('');
  const [newCost, setNewCost] = React.useState('');
  const labelInputRef = React.useRef<TextInput>(null);
  const duplicate = React.useMemo(() => findDuplicateLabel(orderedItems, newLabel), [orderedItems, newLabel]);

  React.useEffect(() => {
    if (autoFocusAdd) labelInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitLabels = (labels: string[]) => {
    const costCents = checklist.type === 'shopping' && newCost.trim() ? Math.round(parseFloat(newCost) * 100) : null;
    const rows = onAdd(labels, { costCents: Number.isFinite(costCents as number) ? costCents : null });
    if (rows.length === 0) return;
    commit();
    setNewLabel('');
    if (rows.length === 1) setNewCost('');
    labelInputRef.current?.focus();
  };

  const addItem = (opts?: { force?: boolean }) => {
    if (!newLabel.trim()) return;
    if (duplicate && !opts?.force) return;
    commitLabels([newLabel]);
  };

  const onLabelChange = (value: string) => {
    if (/[\r\n]/.test(value)) {
      const labels = splitPastedIntoField({ current: '', pasted: value });
      if (labels.length > 0) commitLabels(labels);
      return;
    }
    setNewLabel(value);
  };

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-2 rounded-lg bg-muted/30 px-3 py-2">
        <Input
          ref={labelInputRef}
          value={newLabel}
          onChangeText={onLabelChange}
          placeholder="Add an item…"
          onSubmitEditing={() => addItem()}
          returnKeyType="done"
          multiline
          submitBehavior="submit"
          textAlignVertical="center"
          className="min-w-0 flex-1 border-0 bg-transparent px-0"
        />
        {checklist.type === 'shopping' && (
          <Input
            value={newCost}
            onChangeText={setNewCost}
            placeholder={currencySymbol()}
            keyboardType="decimal-pad"
            onSubmitEditing={() => addItem()}
            submitBehavior="submit"
            className="w-16"
          />
        )}
        <Button size="sm" onPress={() => addItem()} disabled={!newLabel.trim() || !!duplicate}>
          <Plus size={14} className="text-primary-foreground" />
        </Button>
      </View>
      {duplicate && (
        <View className="flex-row flex-wrap items-center gap-1 px-3" accessibilityLiveRegion="polite">
          <Text className="text-caption text-warning">{duplicate.label} is already on this list ·</Text>
          <Pressable onPress={() => addItem({ force: true })} hitSlop={8} accessibilityRole="button">
            <Text className="text-caption text-ring">Add anyway</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export function ChecklistItemList({
  checklist,
  orderedItems,
  viewPrefs,
  variant,
  onToggle,
  onAdd,
  onRename,
  onReprice,
  onDelete,
  onOpenFull,
  autoFocusAdd,
}: ChecklistItemListProps) {
  const sortedItems = React.useMemo(() => sortItems(orderedItems, viewPrefs.sortMode), [orderedItems, viewPrefs.sortMode]);
  const { open: openItems, done: doneItems } = React.useMemo(() => partitionDone(sortedItems), [sortedItems]);
  const { done, total } = React.useMemo(() => completion(orderedItems), [orderedItems]);

  const renderItemRow = (item: ChecklistTaskItem) => (
    <SwipeActions
      key={item.id}
      onSwipeRight={() => onToggle(item)}
      onSwipeLeft={() => onDelete(item)}
      right={item.is_done ? UNCHECK_CFG : DONE_CFG}
      left={DELETE_CFG}
      className="rounded-none"
    >
      <ListItem className={cn('min-h-[44px] px-3 py-2', item.is_done && 'opacity-[0.55]')}>
        <ListItemLeading>
          <Pressable
            onPress={() => onToggle(item)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.is_done }}
            accessibilityLabel={item.is_done ? 'Uncheck' : 'Check'}
            hitSlop={12}
            className={cn('h-5 w-5 items-center justify-center rounded border', item.is_done ? 'border-success bg-success' : 'border-border')}
          >
            {item.is_done && <Check size={12} className="text-success-foreground" />}
          </Pressable>
        </ListItemLeading>
        <ListItemContent>
          <ListItemTitle>
            <EditableText
              value={item.label}
              onCommit={(v) => onRename(item, v)}
              hasChanged={(next, prev) => next.trim() !== prev}
              triggerClassName="min-w-0 shrink"
            >
              <Text numberOfLines={1} className={cn('text-sm', item.is_done ? 'text-muted-foreground line-through' : 'text-foreground')}>
                {item.label}
              </Text>
            </EditableText>
            {checklist.type === 'shopping' && (
              <EditableText
                value={centsToDollars(item.cost_cents)}
                onCommit={(v) => onReprice(item, v)}
                hasChanged={(next, prev) => dollarsToCents(next) !== dollarsToCents(prev)}
                keyboardType="decimal-pad"
                placeholder={currencySymbol()}
                triggerClassName="shrink-0"
              >
                <Text className="text-xs text-muted-foreground">
                  {(item.cost_cents ?? 0) > 0 ? `${currencySymbol()}${centsToDollars(item.cost_cents)}` : '+ price'}
                </Text>
              </EditableText>
            )}
          </ListItemTitle>
          {item.is_done && item.checked_at && (
            <ListItemMeta>
              <Text className="text-[11px] text-muted-foreground">Checked {formatPastDay(new Date(item.checked_at))}</Text>
            </ListItemMeta>
          )}
        </ListItemContent>
      </ListItem>
    </SwipeActions>
  );

  // The add well sits right after the open items, above the Completed band,
  // so new items land where you typed however long the done list grows.
  const addWell = (
    <ChecklistAddWell checklist={checklist} orderedItems={orderedItems} onAdd={onAdd} autoFocusAdd={autoFocusAdd} />
  );
  const bandDone = viewPrefs.completedToBottom && doneItems.length > 0;

  return (
    <View className={cn('gap-2', variant === 'inline' && 'gap-1.5')}>
      {orderedItems.length > 0 && (
        <View className="gap-2">
          {viewPrefs.completedToBottom ? (
            <>
              {openItems.length > 0 && (
                <ListGroup bordered={variant === 'detail'}>{openItems.map(renderItemRow)}</ListGroup>
              )}
              {bandDone && addWell}
              {bandDone && (
                <View className="gap-2">
                  <Pressable
                    onPress={() => {
                      tick();
                      viewPrefs.setCollapsed(!viewPrefs.collapsed);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !viewPrefs.collapsed }}
                    className="flex-row items-center gap-1.5 px-1 py-1"
                  >
                    {viewPrefs.collapsed ? (
                      <ChevronRight size={14} className="text-muted-foreground" />
                    ) : (
                      <ChevronDown size={14} className="text-muted-foreground" />
                    )}
                    <Text className="cap-inscription text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                      Completed
                    </Text>
                    <Text className="text-[11px] text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                      {doneItems.length}
                    </Text>
                  </Pressable>
                  {!viewPrefs.collapsed && (
                    <ListGroup bordered={variant === 'detail'}>{doneItems.map(renderItemRow)}</ListGroup>
                  )}
                </View>
              )}
            </>
          ) : (
            <ListGroup bordered={variant === 'detail'}>{sortedItems.map(renderItemRow)}</ListGroup>
          )}
        </View>
      )}

      {!bandDone && addWell}

      {variant === 'inline' && (
        <View className="flex-row items-center justify-between pt-1">
          <Text className="font-mono text-[11px] text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {done} / {total} done
          </Text>
          {onOpenFull && (
            <Pressable onPress={onOpenFull} hitSlop={8} accessibilityRole="button">
              <Text className="text-caption font-medium text-primary">Open full checklist ›</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
