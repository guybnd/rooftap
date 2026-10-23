// HOUP-224: the row's overflow/hold menu — the "biggest single UX gap" this
// ticket closes (long-press used to jump straight to the edit sheet with no
// menu at all, grocery-item-card.tsx's old onLongPress). Faithful port of web
// grocery-item-card.tsx's `PopMenu` overflow content (lines 822-933): a flat,
// single-scroll menu (no sub-panel back/forward — unlike task-quick-menu.tsx,
// the web spec never nests Assign-to/Move-to-aisle behind their own panels,
// so this doesn't invent navigation the source doesn't have), built on the
// same local BottomSheet + MenuItem/MenuLabel/MenuDivider shape
// task-quick-menu.tsx already established for tasks (packages/ui has no
// shared menu primitive to lean on instead — same substitution that file's
// header comment documents).
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import {
  Archive,
  Check,
  Circle,
  PackageCheck,
  Pencil,
  StickyNote,
  Star,
  Trash2,
  UserPlus,
} from 'lucide-react-native';
import { Text, BottomSheet, GroceryGlyph, cn, haptics } from '@homeup/ui';
import {
  AISLE_ORDER,
  formatMoney,
  getAisleColor,
  getAisleMeta,
  type GroceryCustomAisle,
  type GroceryItem,
  dialog,
} from '@homeup/core';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

function memberLabel(userId: string | null, profiles: MemberProfiles): string {
  if (!userId) return 'Unassigned';
  return profiles[userId]?.name || profiles[userId]?.email || 'Former member';
}

function MenuLabel({ children }: { children: string }) {
  return (
    <Text className="px-3 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </Text>
  );
}

function MenuDivider() {
  return <View className="my-1 h-px bg-border" />;
}

function MenuItem({
  icon,
  label,
  onPress,
  active,
  danger,
}: {
  icon?: React.ReactNode;
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="menuitem"
      onPress={onPress}
      className="flex-row items-center justify-between gap-2 rounded-lg px-3 py-2.5"
    >
      <View className="flex-row items-center gap-2.5">
        {icon}
        <Text className={danger ? 'text-body font-medium text-destructive' : 'text-body text-foreground'}>{label}</Text>
      </View>
      {active && <Check size={16} className="text-primary" />}
    </Pressable>
  );
}

export interface GroceryItemQuickMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: GroceryItem;
  emoji: string;
  qty: string;
  showQty: boolean;
  effectivePriceCents: number | null;
  hasExplicitPrice: boolean;
  customAisles?: GroceryCustomAisle[];
  memberProfiles?: MemberProfiles;
  onSetDisposition: (status: GroceryItem['status']) => void;
  onToggleEssential: () => void;
  onEdit: () => void;
  /** Drops the recipe note chip ("2 count for Cake"). Omitted when the item has none or recipes.groceries is off. */
  onClearRecipeNote?: () => void;
  /** Omitted in reuse contexts (Home hub widget, global search) that don't wire the library-learn flow — mirrors web GroceryItemCardProps' onArchive (FLUX-191). Hides the menu item entirely rather than rendering a dead action. */
  onArchive?: () => void;
  /** Same reuse-context carve-out as onArchive — omitted (not wired to a no-op) where the caller has no delete/undo flow of its own. */
  onRequestDelete?: () => void;
  onAssign: (userId: string | null) => void;
  onSetAisle: (aisle: string) => void;
}

export function GroceryItemQuickMenu({
  open,
  onOpenChange,
  item,
  emoji,
  qty,
  showQty,
  effectivePriceCents,
  hasExplicitPrice,
  customAisles,
  memberProfiles,
  onSetDisposition,
  onToggleEssential,
  onEdit,
  onClearRecipeNote,
  onArchive,
  onRequestDelete,
  onAssign,
  onSetAisle,
}: GroceryItemQuickMenuProps) {
  const bought = item.status === 'bought';
  const have = item.status === 'have';
  const close = () => onOpenChange(false);

  // HA: the pulse matches the change. Dispositions pass none: the list's
  // patch handler already fires success/tick/celebrate for them.
  const commit = (fn: () => void, feel: (() => void) | null = haptics.select) => {
    feel?.();
    fn();
    close();
  };

  const allAisles = React.useMemo(
    () => [
      ...AISLE_ORDER.map((a) => ({ id: a as string, label: getAisleMeta(a).label, dot: getAisleColor(a).dot })),
      ...(customAisles ?? []).map((a) => ({ id: a.name, label: a.name, dot: getAisleColor(a.name, customAisles).dot })),
    ],
    [customAisles]
  );

  const members = Object.entries(memberProfiles ?? {});

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      {/* Live preview header — E1: the header states the item (web card.tsx:828-841). */}
      <View className="flex-row items-center gap-2 border-b border-border px-4 pb-3">
        <GroceryGlyph emoji={emoji} size={20} />
        <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-medium text-foreground">
          {item.name}
          {showQty && <Text className="ml-1.5 text-xs font-normal text-muted-foreground"> {qty}</Text>}
        </Text>
        {effectivePriceCents != null && (
          <Text className="shrink-0 text-sm font-medium text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {hasExplicitPrice ? '' : '~'}
            {formatMoney(effectivePriceCents)}
          </Text>
        )}
      </View>

      <ScrollView className="max-h-96 px-1 py-1">
        {/* Mark as — top of the menu (matches web's ordering rationale,
            page.tsx/grocery-item-card.tsx: most-used section goes first). */}
        <MenuLabel>Mark as</MenuLabel>
        <MenuItem
          active={item.status === 'needed'}
          icon={<Circle size={14} className="text-muted-foreground" />}
          label="Needed"
          onPress={() => commit(() => onSetDisposition('needed'), null)}
        />
        <MenuItem
          active={bought}
          icon={<Check size={14} className="text-success" />}
          label="Bought"
          onPress={() => commit(() => onSetDisposition('bought'), null)}
        />
        <MenuItem
          active={have}
          icon={<PackageCheck size={14} className="text-primary" />}
          label="Have it"
          onPress={() => commit(() => onSetDisposition('have'), null)}
        />
        <MenuItem
          active={!!item.is_essential}
          icon={<Star size={14} className={cn(item.is_essential ? 'text-warning fill-current' : 'text-muted-foreground')} />}
          label={item.is_essential ? 'Essential' : 'Mark essential'}
          onPress={() => commit(onToggleEssential)}
        />

        <MenuDivider />

        <MenuItem
          icon={<Pencil size={14} className="text-muted-foreground" />}
          label="Edit details"
          onPress={() => {
            close();
            setTimeout(onEdit, 0);
          }}
        />
        {onClearRecipeNote && (
          <MenuItem
            icon={<StickyNote size={14} className="text-muted-foreground" />}
            label="Remove recipe note"
            onPress={() => commit(onClearRecipeNote)}
          />
        )}
        {/* Archive: learns the item to the library, no confirm (distinct from
            Delete below — mirrors web page.tsx's handleArchive). Hidden
            entirely (not a dead button) where the caller omitted it. */}
        {onArchive && (
          <MenuItem
            icon={<Archive size={14} className="text-muted-foreground" />}
            label="Archive"
            onPress={() => commit(onArchive, haptics.remove)}
          />
        )}
        {/* Delete: destructive, confirm, never learns to the library —
            mirrors web page.tsx's handleRequestDelete. Same hide-if-absent
            treatment as Archive. */}
        {onRequestDelete && (
          <MenuItem
            danger
            icon={<Trash2 size={14} className="text-destructive" />}
            label="Delete"
            onPress={() => {
              dialog.alert(`Delete "${item.name}"?`, 'This removes it from the list.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => commit(onRequestDelete, haptics.remove) },
              ]);
            }}
          />
        )}

        <MenuDivider />

        {/* Assign to — second from the bottom (matches web's ordering). */}
        <MenuLabel>Assign to</MenuLabel>
        <MenuItem
          active={!item.assigned_to}
          icon={<UserPlus size={14} className="text-muted-foreground" />}
          label="Unassigned"
          onPress={() => commit(() => onAssign(null))}
        />
        {members.map(([id, p]) => (
          <MenuItem
            key={id}
            active={item.assigned_to === id}
            icon={
              <View className="h-5 w-5 items-center justify-center rounded-full bg-muted">
                <Text className="text-[10px] font-bold uppercase text-foreground">
                  {memberLabel(id, memberProfiles ?? {}).charAt(0)}
                </Text>
              </View>
            }
            label={p.name || p.email || 'Member'}
            onPress={() => commit(() => onAssign(id))}
          />
        ))}

        <MenuDivider />

        {/* Move to aisle — bottom-most (longest, least-frequently-changed
            list, matches web's ordering). */}
        <MenuLabel>Move to aisle</MenuLabel>
        {allAisles.map((a) => (
          <MenuItem
            key={a.id}
            active={item.aisle === a.id}
            icon={<View className={cn('h-2.5 w-2.5 rounded-full', a.dot)} />}
            label={a.label}
            onPress={() =>
              commit(() => {
                if (a.id !== item.aisle) onSetAisle(a.id);
              })
            }
          />
        ))}
      </ScrollView>
    </BottomSheet>
  );
}
