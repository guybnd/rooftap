// The native twin of web's right-click row menu (Hearth §13.7 "Row menu";
// web: apps/web/src/components/ui/row-context-menu.tsx). A row hands
// useRowMenuSheet its RowMenu (core row-actions.ts) on a long press; this
// draws it as a bottom sheet in the shared order (open, main verb, quick
// settings, share, edit, delete), with the item's name on top (E1). An
// action with choices opens them in place, with a way back. Delete and
// friends sit alone at the end (E4).
//
// Use it for any new module's rows instead of a local hold sheet:
//
//   const rowMenu = useRowMenuSheet();
//   <ListItem onLongPress={() => rowMenu.open(fooRowMenu(item, handlers))} />
//   {rowMenu.sheet}
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import {
  AlarmClock,
  Archive,
  ArrowUpRight,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  EyeOff,
  Files,
  Flag,
  FolderInput,
  ListChecks,
  ListTodo,
  MessageSquare,
  Navigation,
  Pencil,
  Repeat,
  RotateCcw,
  Share2,
  SquareMousePointer,
  Star,
  StickyNote,
  Trash2,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';
import { arrangeRowActions, type RowAction, type RowActionIcon, type RowMenu } from '@homeup/core';
import { BottomSheet } from './bottom-sheet';
import { Text } from './text';
import { cn } from '../lib/cn';
import * as haptics from '../lib/haptics';

const ICONS: Record<RowActionIcon, LucideIcon> = {
  open: ArrowUpRight,
  done: CheckCircle2,
  undo: RotateCcw,
  due: CalendarClock,
  snooze: AlarmClock,
  repeat: Repeat,
  assign: UserRound,
  priority: Flag,
  move: FolderInput,
  status: ListChecks,
  checklist: ListTodo,
  comment: MessageSquare,
  note: StickyNote,
  star: Star,
  share: Share2,
  copy: Copy,
  duplicate: Files,
  calendar: CalendarPlus,
  cost: Wallet,
  directions: Navigation,
  hide: EyeOff,
  select: SquareMousePointer,
  edit: Pencil,
  archive: Archive,
  delete: Trash2,
};

export interface RowMenuSheetProps {
  /** The menu to show; null closes the sheet. */
  menu: RowMenu | null;
  onClose: () => void;
}

export function RowMenuSheet({ menu, onClose }: RowMenuSheetProps) {
  const [sub, setSub] = React.useState<RowAction | null>(null);
  React.useEffect(() => setSub(null), [menu]);
  const groups = menu ? arrangeRowActions(menu.actions) : [];

  const run = (fn: (() => void) | undefined) => {
    onClose();
    // Let the sheet go before the next one (an editor, a picker) comes up.
    setTimeout(() => fn?.(), 0);
  };

  return (
    <BottomSheet open={!!menu} onOpenChange={(o) => { if (!o) onClose(); }} className="pb-3">
      {menu ? (
        <>
          <View className="flex-row items-center gap-2.5 border-b border-border px-4 pb-3">
            {sub ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => setSub(null)} hitSlop={8}>
                <ChevronLeft size={18} className="text-muted-foreground" />
              </Pressable>
            ) : null}
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="text-sm font-semibold text-foreground">
                {sub ? sub.label : menu.title}
              </Text>
              {!sub && menu.kind ? (
                <Text numberOfLines={1} className="text-xs text-muted-foreground">
                  {menu.kind}
                </Text>
              ) : null}
            </View>
          </View>
          <ScrollView className="max-h-[520px] px-1 pt-1">
            {sub ? (
              sub.options?.map((o) => (
                <Pressable
                  key={o.id}
                  accessibilityRole="menuitem"
                  accessibilityState={{ checked: !!o.checked }}
                  onPress={() => {
                    haptics.tick();
                    run(o.checked ? undefined : o.run);
                  }}
                  className="min-h-11 flex-row items-center gap-2.5 rounded-lg px-3 py-2.5"
                >
                  <View className="w-3.5">{o.checked ? <Check size={14} className="text-foreground" /> : null}</View>
                  <Text className="flex-1 text-body text-foreground">{o.label}</Text>
                  {o.hint ? <Text className="text-sm text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>{o.hint}</Text> : null}
                </Pressable>
              ))
            ) : (
              groups.map((group, gi) => (
                <View key={group[0].group} className={cn(gi > 0 && 'mt-1 border-t border-border pt-1')}>
                  {group.map((a) => (
                    <MenuItem
                      key={a.id}
                      action={a}
                      onPress={() => {
                        if (a.disabled) return;
                        if (a.options) {
                          haptics.select();
                          setSub(a);
                        } else {
                          run(a.run);
                        }
                      }}
                    />
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        </>
      ) : null}
    </BottomSheet>
  );
}

function MenuItem({ action, onPress }: { action: RowAction; onPress: () => void }) {
  const Icon = action.icon ? ICONS[action.icon] : undefined;
  const danger = action.danger || action.group === 'danger';
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityState={{ disabled: !!action.disabled }}
      onPress={onPress}
      className={cn('min-h-11 flex-row items-center gap-2.5 rounded-lg px-3 py-2.5', action.disabled && 'opacity-50')}
    >
      {Icon ? <Icon size={14} className={danger ? 'text-destructive' : 'text-muted-foreground'} /> : null}
      <Text className={cn('flex-1 text-body', danger ? 'font-medium text-destructive' : 'text-foreground')}>{action.label}</Text>
      {action.value ? <Text className="text-sm text-muted-foreground">{action.value}</Text> : null}
      {action.options ? <ChevronRight size={14} className="text-muted-foreground" /> : null}
    </Pressable>
  );
}

/**
 * A row's hold menu. Call `open(menu)` from a row's onLongPress and render
 * `sheet` once in the screen. An empty menu does nothing.
 */
export function useRowMenuSheet() {
  const [menu, setMenu] = React.useState<RowMenu | null>(null);
  const open = React.useCallback((next: RowMenu | null) => {
    if (!next || arrangeRowActions(next.actions).length === 0) return false;
    haptics.commit();
    setMenu(next);
    return true;
  }, []);
  const close = React.useCallback(() => setMenu(null), []);
  const sheet = <RowMenuSheet menu={menu} onClose={close} />;
  return { open, close, sheet, isOpen: !!menu };
}
