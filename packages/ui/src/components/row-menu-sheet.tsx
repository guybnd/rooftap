// The native twin of web's right-click row menu (Hearth §13.7 "Row menu";
// web: apps/web/src/components/ui/row-context-menu.tsx). A row hands
// useRowMenuSheet its RowMenu (core row-actions.ts) on a long press; this
// draws it as a bottom sheet in the shared order (open, main verb, quick
// settings, share, edit, delete), with the item's name on top (E1). Up to
// four main moves lead as a strip of big targets (Hearth §13.11), the rest
// are rows in one group. An action with choices opens them in place, with a
// way back. Delete and friends sit alone at the end (E4).
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
import { LeadingTile } from './leading-tile';
import { ListGroup } from './list-item';
import { useSectionId } from './section-glow';
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

/** Resolves a section's glyph for the sheet's header tile. The app sets it once (its section icon map). */
let sectionGlyph: ((sectionId: string) => LucideIcon | undefined) | null = null;
export function setRowMenuSectionGlyph(resolve: (sectionId: string) => LucideIcon | undefined) {
  sectionGlyph = resolve;
}

/** Groups whose actions may lead in the strip, in order: the main verb, quick settings, then edit. */
const STRIP_GROUPS = ['state', 'set', 'edit'] as const;
const STRIP_MAX = 4;
const STRIP_MIN = 3;

/**
 * The menu split for the sheet (Hearth §13.11): up to four main moves for
 * the strip, the rest as rows, and Delete and friends on their own.
 */
export function splitRowMenu(actions: RowMenu['actions']): { strip: RowAction[]; rows: RowAction[][]; danger: RowAction[] } {
  const groups = arrangeRowActions(actions);
  const flat = groups.flat();
  const candidates = STRIP_GROUPS.flatMap((g) => flat.filter((a) => a.group === g && a.icon));
  const strip = candidates.length >= STRIP_MIN ? candidates.slice(0, STRIP_MAX) : [];
  const inStrip = new Set(strip.map((a) => a.id));
  const rows = groups
    .filter((g) => g[0].group !== 'danger')
    .map((g) => g.filter((a) => !inStrip.has(a.id)))
    .filter((g) => g.length > 0);
  const danger = flat.filter((a) => a.group === 'danger');
  return { strip, rows, danger };
}

export interface RowMenuSheetProps {
  /** The menu to show; null closes the sheet. */
  menu: RowMenu | null;
  onClose: () => void;
}

export function RowMenuSheet({ menu, onClose }: RowMenuSheetProps) {
  const [sub, setSub] = React.useState<RowAction | null>(null);
  React.useEffect(() => setSub(null), [menu]);
  const contextSection = useSectionId();
  const { strip, rows, danger } = menu ? splitRowMenu(menu.actions) : { strip: [], rows: [], danger: [] };
  const section = contextSection;
  const Glyph = section && sectionGlyph ? sectionGlyph(section) : undefined;

  const run = (fn: (() => void) | undefined) => {
    onClose();
    // Let the sheet go before the next one (an editor, a picker) comes up.
    setTimeout(() => fn?.(), 0);
  };
  const pick = (a: RowAction) => {
    if (a.disabled) return;
    if (a.options) {
      haptics.select();
      setSub(a);
    } else {
      run(a.run);
    }
  };

  return (
    <BottomSheet open={!!menu} onOpenChange={(o) => { if (!o) onClose(); }} className="pb-3" handleClassName="bg-muted/40">
      {menu ? (
        <>
          {/* The item itself on the composer band (Hearth §13.11), so you
              can see what you are holding. */}
          <View className="flex-row items-center gap-3 border-b border-border bg-muted/40 px-4 pb-3">
            {sub ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => setSub(null)} hitSlop={8}>
                <ChevronLeft size={18} className="text-muted-foreground" />
              </Pressable>
            ) : Glyph ? (
              <LeadingTile sectionId={section ?? undefined} Icon={Glyph} size="md" />
            ) : null}
            <View className="min-w-0 flex-1">
              <Text numberOfLines={2} className="text-body font-semibold text-foreground">
                {sub ? sub.label : menu.title}
              </Text>
              {!sub && menu.kind ? (
                <Text numberOfLines={1} className="text-xs text-muted-foreground">
                  {menu.kind}
                </Text>
              ) : null}
            </View>
          </View>
          <ScrollView className="max-h-[560px]" contentContainerClassName="gap-3 px-3 pt-3">
            {sub ? (
              <ListGroup>
                {(sub.options ?? []).map((o) => (
                  <Pressable
                    key={o.id}
                    accessibilityRole="menuitem"
                    accessibilityState={{ checked: !!o.checked }}
                    onPress={() => {
                      haptics.tick();
                      run(o.checked ? undefined : o.run);
                    }}
                    className="min-h-12 flex-row items-center gap-2.5 px-4 py-2.5 active:bg-muted/60"
                  >
                    <View className="w-3.5">{o.checked ? <Check size={14} className="text-foreground" /> : null}</View>
                    <Text className="flex-1 text-body text-foreground">{o.label}</Text>
                    {o.hint ? <Text className="text-sm text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>{o.hint}</Text> : null}
                  </Pressable>
                ))}
              </ListGroup>
            ) : (
              <>
                {strip.length > 0 && (
                  <ListGroup>
                    <View className="flex-row">
                      {strip.map((a, i) => (
                        <StripCell key={a.id} action={a} first={i === 0} onPress={() => pick(a)} />
                      ))}
                    </View>
                  </ListGroup>
                )}
                {rows.length > 0 && (
                  <ListGroup>
                    {rows.flat().map((a) => (
                      <MenuItem key={a.id} action={a} onPress={() => pick(a)} />
                    ))}
                  </ListGroup>
                )}
                {danger.length > 0 && (
                  <ListGroup>
                    {danger.map((a) => (
                      <MenuItem key={a.id} action={a} onPress={() => pick(a)} />
                    ))}
                  </ListGroup>
                )}
              </>
            )}
          </ScrollView>
        </>
      ) : null}
    </BottomSheet>
  );
}

/** One of the main moves: a big target with its glyph over its name. */
function StripCell({ action, first, onPress }: { action: RowAction; first: boolean; onPress: () => void }) {
  const Icon = action.icon ? ICONS[action.icon] : undefined;
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={action.value ? `${action.label}, ${action.value}` : action.label}
      accessibilityState={{ disabled: !!action.disabled }}
      onPress={onPress}
      className={cn('flex-1 items-center gap-1.5 px-1 py-3 active:bg-muted/60', !first && 'border-l border-border', action.disabled && 'opacity-50')}
    >
      <View className="size-10 items-center justify-center rounded-[13px] bg-muted">{Icon ? <Icon size={19} className="text-foreground" /> : null}</View>
      <Text numberOfLines={1} className="text-xs font-medium text-foreground">
        {action.label}
      </Text>
    </Pressable>
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
      className={cn('min-h-12 flex-row items-center gap-3 px-4 py-2.5 active:bg-muted/60', action.disabled && 'opacity-50')}
    >
      {Icon ? <Icon size={16} className={danger ? 'text-destructive' : 'text-muted-foreground'} /> : null}
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
