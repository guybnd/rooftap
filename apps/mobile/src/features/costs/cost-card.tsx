// HOUP-82: native cost row. SwipeActions (swipe left reveals delete) wraps a
// ListItem — the same per-row combo apps/web/src/app/setup/setup-item-card.tsx
// already uses. Deferred vs. the web CostCard (apps/web/src/app/costs/cost-card.tsx):
// attachments/comments portals, who-pays avatar, the hold-menu quick-editors —
// see index.tsx's follow-up note; those stay web-only for this pass.
// HOUP-174: leading dot promoted to a 28px category-icon square, neutral since
// Hearth v2 (mirrors
// apps/mobile/src/app/(tabs)/home/index.tsx's `h-7 w-7` icon-square pattern) and the
// meta date fragment ported from an absolute "2 Aug" to a relative label (H6),
// mirroring apps/web/src/app/tasks/task-row.tsx's `dueMeta` grammar adapted for
// a cost occurrence that can land in the past (one-off already happened /
// added-at fallback) or the future (this month's still-upcoming recurring
// occurrence). Select mode (HOUP-174) swaps the leading icon for a checkbox and
// suppresses swipe, mirroring apps/mobile/src/features/groceries/grocery-item-card.tsx.
// HOUP-218: Docs/Comments portal chips (PC1-6) + a single inline expand panel
// (web's `expanded: 'docs' | 'comments' | null`), and a per-row who-pays
// AssigneePicker + payer avatar in the trailing slot — ported from web's
// cost-card.tsx. Suppressed in select mode (mirrors web's `leading` bulk
// checkbox not changing the row's portal/assignee affordances, but native's
// select mode already swaps the whole leading slot and disables swipe, so the
// simplest-consistent choice is to hide the row's secondary content there too).
import * as React from 'react';
import { View } from 'react-native';
import {
  Banknote,
  Car,
  Check,
  FileText,
  HeartPulse,
  Landmark,
  MessageSquare,
  MoreHorizontal,
  ArrowDownLeft,
  Paperclip,
  PawPrint,
  Pencil,
  Repeat,
  ShieldCheck,
  ShoppingBag,
  Ticket,
  ShoppingCart,
  Trash2,
  Truck,
  Users,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
import {
  Text,
  AssigneePicker,
  BottomSheet,
  DragNumberField,
  EntityComments,
  ListGroup,
  ListItem,
  ListItemBody,
  ListItemLeading,
  ListItemContent,
  ListItemTitle,
  ListItemMeta,
  ListItemTrailing,
  PortalChipRow,
  SearchablePicker,
  SegmentedControl,
  SwipeActions,
  cn,
  useThemeMaterial,
  haptics,
  useHoldFill,
  type PortalChipDef,
  type PickerOption,
} from '@homeup/ui';
import {
  CADENCE_LABEL,
  CATEGORY_META,
  formatMoney,
  listDocumentsForEntity,
  timeAgo,
  syncCostReminders,
  type StepBackResult,
  useEntityCommentCount,
  useModules,
  useCostBankLink,
  costRowDateLabel,
  expiryLabel,
  soonestCostExpiry,
  useCostActual,
  useCostCategoryChoices,
  monthLabel,
  type CostCategory,
  type CostCadence,
  type CostItem,
  type HueScheme,
  hueSchemeTone,
  type GroupMember,
  currencySymbol,
} from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { CostDocuments } from './cost-documents';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

interface CostRowProps {
  item: CostItem;
  groupId: string;
  currentUserId: string | null;
  groupMembers: GroupMember[];
  memberProfiles: MemberProfiles;
  onEdit: (item: CostItem) => void;
  onDelete: (item: CostItem) => void;
  onUpdate: (item: CostItem) => void;
  onAssign: (id: string, userId: string) => void;
  estimateStepBack?: StepBackResult;
  /** A hand-made estimate that became its category's target: out of the totals (core costTargets). */
  target?: boolean;
  /** The month the list shows, YYYY-MM: a line linked to the bank says what was paid in it. */
  month?: string;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

// HOUP-219: matches task/setup long-press timing (Hearth E1-E4/M3) and drives
// the shared hold-fill overlay instead of an ad-hoc timer.
const LONG_PRESS_MS = 500;
const CADENCE_OPTIONS: CostCadence[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly', 'one_off'];
const CADENCE_SEGMENTS = CADENCE_OPTIONS.map((c) => ({ value: c, label: CADENCE_LABEL[c] }));

// One lucide glyph per category, in a chip tinted with the category's pastel
// (the same hues the chart keys its series with). The group title takes the
// darker text shade. Literal classes so NativeWind sees them; web reads the
// same palette from core's CATEGORY_COLOR (apps/web/src/app/costs/category-glyph.tsx).
/** Each category's solid bar colour (spend meters and the Costs chart). */
export const CATEGORY_BAR_FILL: Record<CostCategory | 'rest', string> = {
  rent: 'bg-blue-300',
  utilities: 'bg-amber-200',
  internet: 'bg-cyan-300',
  insurance: 'bg-violet-300',
  subscription: 'bg-pink-300',
  grocery_estimate: 'bg-lime-200',
  moving: 'bg-orange-300',
  purchase: 'bg-fuchsia-300',
  outing: 'bg-sky-200',
  transport: 'bg-indigo-300',
  health: 'bg-teal-300',
  pets: 'bg-emerald-200',
  family: 'bg-rose-200',
  other: 'bg-slate-400',
  income: 'bg-green-400',
  rest: 'bg-foreground/45',
};

const CATEGORY_TILE: Record<'light' | 'dark', Record<CostCategory, { tile: string; glyph: string; title: string }>> = {
  light: {
    rent: { tile: 'bg-blue-300/20', glyph: 'text-blue-700', title: 'text-blue-600' },
    utilities: { tile: 'bg-amber-200/20', glyph: 'text-amber-700', title: 'text-amber-600' },
    internet: { tile: 'bg-cyan-300/20', glyph: 'text-cyan-700', title: 'text-cyan-600' },
    insurance: { tile: 'bg-violet-300/20', glyph: 'text-violet-700', title: 'text-violet-600' },
    subscription: { tile: 'bg-pink-300/20', glyph: 'text-pink-700', title: 'text-pink-600' },
    grocery_estimate: { tile: 'bg-lime-200/20', glyph: 'text-lime-700', title: 'text-lime-600' },
    moving: { tile: 'bg-orange-300/20', glyph: 'text-orange-700', title: 'text-orange-600' },
    purchase: { tile: 'bg-fuchsia-300/20', glyph: 'text-fuchsia-700', title: 'text-fuchsia-600' },
    outing: { tile: 'bg-sky-200/20', glyph: 'text-sky-700', title: 'text-sky-600' },
    transport: { tile: 'bg-indigo-300/20', glyph: 'text-indigo-700', title: 'text-indigo-600' },
    health: { tile: 'bg-teal-300/20', glyph: 'text-teal-700', title: 'text-teal-600' },
    pets: { tile: 'bg-emerald-200/20', glyph: 'text-emerald-700', title: 'text-emerald-600' },
    family: { tile: 'bg-rose-200/20', glyph: 'text-rose-700', title: 'text-rose-600' },
    other: { tile: 'bg-slate-400/20', glyph: 'text-slate-700', title: 'text-slate-600' },
    income: { tile: 'bg-green-400/20', glyph: 'text-green-700', title: 'text-green-700' },
  },
  dark: {
    rent: { tile: 'bg-blue-300/15', glyph: 'text-blue-200', title: 'text-blue-200' },
    utilities: { tile: 'bg-amber-200/15', glyph: 'text-amber-100', title: 'text-amber-100' },
    internet: { tile: 'bg-cyan-300/15', glyph: 'text-cyan-200', title: 'text-cyan-200' },
    insurance: { tile: 'bg-violet-300/15', glyph: 'text-violet-200', title: 'text-violet-200' },
    subscription: { tile: 'bg-pink-300/15', glyph: 'text-pink-200', title: 'text-pink-200' },
    grocery_estimate: { tile: 'bg-lime-200/15', glyph: 'text-lime-100', title: 'text-lime-100' },
    moving: { tile: 'bg-orange-300/15', glyph: 'text-orange-200', title: 'text-orange-200' },
    purchase: { tile: 'bg-fuchsia-300/15', glyph: 'text-fuchsia-200', title: 'text-fuchsia-200' },
    outing: { tile: 'bg-sky-200/15', glyph: 'text-sky-100', title: 'text-sky-100' },
    transport: { tile: 'bg-indigo-300/15', glyph: 'text-indigo-200', title: 'text-indigo-200' },
    health: { tile: 'bg-teal-300/15', glyph: 'text-teal-200', title: 'text-teal-200' },
    pets: { tile: 'bg-emerald-200/15', glyph: 'text-emerald-100', title: 'text-emerald-100' },
    family: { tile: 'bg-rose-200/15', glyph: 'text-rose-100', title: 'text-rose-100' },
    other: { tile: 'bg-slate-400/15', glyph: 'text-slate-300', title: 'text-slate-300' },
    income: { tile: 'bg-green-400/15', glyph: 'text-green-300', title: 'text-green-300' },
  },
};

// The e-paper theme: one grey chip for every category; the glyph and the
// group's name tell them apart.
const INK_TINT = { tile: 'bg-foreground/10', glyph: 'text-foreground', title: 'text-muted-foreground' };

/** A category's tint (chip, glyph and group title classes) in a theme, or null for an unknown category. */
export function categoryTint(scheme: HueScheme, category: string) {
  const tone = hueSchemeTone(scheme);
  if (tone === 'ink') return category in CATEGORY_TILE.light ? INK_TINT : null;
  return CATEGORY_TILE[tone][category as CostCategory] ?? null;
}

const CATEGORY_ICON: Record<CostCategory, LucideIcon> = {
  rent: Banknote,
  utilities: Zap,
  internet: Wifi,
  insurance: ShieldCheck,
  subscription: Repeat,
  grocery_estimate: ShoppingCart,
  moving: Truck,
  purchase: ShoppingBag,
  outing: Ticket,
  transport: Car,
  health: HeartPulse,
  pets: PawPrint,
  family: Users,
  other: MoreHorizontal,
  income: ArrowDownLeft,
};

export function CategoryChip({ category }: { category: CostCategory }) {
  const Icon = CATEGORY_ICON[category] ?? MoreHorizontal;
  const tint = categoryTint(useThemeMaterial().scheme, category);
  return (
    <View className={cn('h-7 w-7 items-center justify-center rounded-[9px]', tint?.tile ?? 'bg-muted')}>
      <Icon size={15} className={tint?.glyph ?? 'text-muted-foreground'} />
    </View>
  );
}

// H6: the row's date is relative, never "7 Oct" or raw ISO (core
// costs/cost-dates.ts, shared with web).
export function CostRow({
  item,
  groupId,
  currentUserId,
  groupMembers,
  memberProfiles,
  onEdit,
  onDelete,
  onUpdate,
  onAssign,
  estimateStepBack,
  target,
  month,
  selectMode,
  selected,
  onToggleSelect,
}: CostRowProps) {
  // Up Bank: a line linked to payments says when it was last paid instead of its date.
  const bankLink = useCostBankLink(item.id);
  const paidInMonth = useCostActual(item.id, month);
  const categoryChoices = useCostCategoryChoices(item.category);
  const categoryPickerOptions = React.useMemo<PickerOption[]>(
    () => categoryChoices.map((c) => ({ value: c, primary: CATEGORY_META[c].label })),
    [categoryChoices]
  );

  const [expanded, setExpanded] = React.useState<'docs' | 'comments' | null>(null);
  const [quickSheetOpen, setQuickSheetOpen] = React.useState(false);
  const [docCount, setDocCount] = React.useState<number | null>(null);
  const holdFill = useHoldFill(LONG_PRESS_MS);
  const modules = useModules();
  // Modules: the Docs chip, Files row and docs panel need documents and costs (module-features.ts).
  const docsLinked = modules.feature('documents.costs');
  // A docs panel left open when Documents is switched off closes with it.
  const panel = expanded === 'docs' && !docsLinked ? null : expanded;

  const patch = React.useCallback(
    (payload: Partial<CostItem>) => {
      const updated = { ...item, ...payload } as CostItem;
      onUpdate(updated);
      if (updated.end_date || updated.discount_end_date || item.end_date || item.discount_end_date) {
        try {
          void syncCostReminders(updated, getCurrentSupabaseClient()).catch(() => {});
        } catch {
          // Client not bound yet; the local edit still went through.
        }
      }
    },
    [item, onUpdate]
  );

  // FLUX-109 parity: eagerly compute the attachment count so the collapsed
  // chip shows it without expanding the panel.
  React.useEffect(() => {
    if (!docsLinked) return;
    let cancelled = false;
    (async () => {
      const count = await listDocumentsForEntity(getCurrentSupabaseClient(), 'cost_item', item.id);
      if (!cancelled) setDocCount(count.length);
    })();
    return () => {
      cancelled = true;
    };
  }, [item.id, docsLinked]);

  const commentCount = useEntityCommentCount(getCurrentSupabaseClient(), {
    table: 'cost_item_comments',
    fkColumn: 'cost_item_id',
    entityId: item.id,
  });

  // Mirrors apps/web/src/app/costs/cost-card.tsx's dateLabel: a one-off shows
  // its own start_date; a recurring cost shows this month's cadence-derived
  // occurrence; falling back to "added {relative}" from created_at when there's
  // no start_date (or an ended recurring cost's occurrence resolves to null).
  // Both null-guarded — local-first inserts can lack a date.
  const dateLabel = costRowDateLabel(item);
  const soonest = soonestCostExpiry(item);
  // A contract or discount ending within 30 days (or already ended).
  const expiry = soonest && soonest.days <= 30 ? { text: expiryLabel(soonest.kind, soonest.days), overdue: soonest.days < 0 } : null;
  const paidAgo = bankLink?.lastPaidAt ? timeAgo(bankLink.lastPaidAt) : null;

  // Portals (PC1-7): attachments + comments both "open in place" (neutral
  // tone), rendered as the row's second content line via PortalChipRow —
  // mirrors web's cost-card.tsx portalChips. A portal with nothing behind it
  // yet prints nothing on the row (PC7): the hold sheet's Files and Comments
  // rows are how the first one gets added.
  const portalChips: PortalChipDef[] = [];
  if (docsLinked && ((docCount != null && docCount > 0) || expanded === 'docs')) {
    portalChips.push({
      key: 'docs',
      icon: <Paperclip size={12} className="text-muted-foreground" />,
      label: docCount != null && docCount > 0 ? `${docCount} file${docCount === 1 ? '' : 's'}` : 'Files',
      tone: 'neutral',
      onOpen: () => setExpanded((cur) => (cur === 'docs' ? null : 'docs')),
    });
  }
  if (commentCount.count > 0 || expanded === 'comments') {
    portalChips.push({
      key: 'comments',
      icon: <MessageSquare size={12} className="text-muted-foreground" />,
      label: commentCount.count > 0 ? `${commentCount.count} comment${commentCount.count === 1 ? '' : 's'}` : 'Comments',
      tone: 'neutral',
      onOpen: () => setExpanded((cur) => (cur === 'comments' ? null : 'comments')),
    });
  }

  const row = (
    <ListItem
      expanded={!selectMode && !!panel}
      holdProgress={!selectMode ? holdFill.progress : undefined}
      onPress={() => (selectMode ? onToggleSelect?.(item.id) : onEdit(item))}
    >
      <ListItemLeading>
        {selectMode ? (
          <View
            className={cn(
              'h-5 w-5 items-center justify-center rounded-full border-2',
              selected ? 'border-primary bg-primary' : 'border-border'
            )}
          >
            {selected && <Check size={12} className="text-primary-foreground" />}
          </View>
        ) : (
          <CategoryChip category={item.category} />
        )}
      </ListItemLeading>

      <ListItemContent>
        <ListItemTitle>
          <Text numberOfLines={1} className="min-w-0 flex-1 font-medium text-foreground">
            {item.name}
          </Text>
          {item.bank_source && (
            <View accessible accessibilityLabel="From Up" className="shrink-0">
              <Landmark size={12} className="text-muted-foreground" />
            </View>
          )}
          {item.is_estimate && (
            <Text
              className={cn(
                'shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground',
                estimateStepBack && estimateStepBack.est > 0 && estimateStepBack.act >= estimateStepBack.est && 'bg-muted/50 text-muted-foreground/60'
              )}
            >
              {estimateStepBack && estimateStepBack.est > 0 && estimateStepBack.act >= estimateStepBack.est
                ? 'covered'
                : estimateStepBack && estimateStepBack.act > 0
                  ? `${formatMoney(estimateStepBack.remaining)} left`
                  : 'est'}
            </Text>
          )}
        </ListItemTitle>
        {/* Meta (H6): at most two fragments. A contract or discount ending
            within 30 days is the status fragment and takes the date's place. */}
        {(target || paidInMonth != null || expiry || paidAgo || dateLabel || item.provider) && (
          <ListItemMeta>
            {target ? (
              // Out of the totals: the vendor lines the bank files carry the spend.
              <Text className="text-caption text-muted-foreground" numberOfLines={1}>
                Target for the category
              </Text>
            ) : paidInMonth != null && month ? (
              <Text className="text-caption text-success" style={{ fontVariant: ['tabular-nums'] }} numberOfLines={1}>
                Paid {formatMoney(paidInMonth)} in {monthLabel(`${month}-01`)}
              </Text>
            ) : expiry ? (
              <Text
                className={cn('text-caption', expiry.overdue ? 'text-destructive' : 'text-warning')}
                style={{ fontVariant: ['tabular-nums'] }}
                numberOfLines={1}
              >
                {expiry.text}
              </Text>
            ) : paidAgo ? (
              <Text className="text-caption text-success" style={{ fontVariant: ['tabular-nums'] }} numberOfLines={1}>
                Paid {paidAgo.toLowerCase()}
              </Text>
            ) : dateLabel ? (
              <Text className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {dateLabel}
              </Text>
            ) : null}
            {item.provider && (
              <Text className="text-caption text-muted-foreground" numberOfLines={1}>
                {item.provider}
              </Text>
            )}
          </ListItemMeta>
        )}

        {!selectMode && portalChips.length > 0 && (
          <PortalChipRow chips={portalChips} className="mt-1.5" overflowTitle="More" />
        )}
      </ListItemContent>

      {/* Trailing: amount + cadence read as one value, the payer avatar as the
          one identity (H2 — max two elements). */}
      <ListItemTrailing className="gap-2">
        {/* Amount over its cadence word: one stacked value, so the content
            column keeps its width (mirrors web). */}
        <View className="items-end">
          <Text className="font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {formatMoney(item.amount)}
          </Text>
          <Text className="text-caption text-muted-foreground">{CADENCE_LABEL[item.cadence]}</Text>
        </View>
        {!selectMode && (
          <AssigneePicker
            value={item.assigned_to}
            groupMembers={groupMembers}
            memberProfiles={memberProfiles}
            currentUserId={currentUserId}
            onChange={(userId) => onAssign(item.id, userId)}
          />
        )}
      </ListItemTrailing>
    </ListItem>
  );

  return (
    <View>
      {selectMode ? (
        row
      ) : (
        <SwipeActions
          onSwipeLeft={() => onDelete(item)}
          longPressMs={LONG_PRESS_MS}
          onLongPress={() => {
            haptics.commit();
            setQuickSheetOpen(true);
          }}
          onHoldStart={holdFill.start}
          onHoldEnd={holdFill.stop}
          left={{
            bg: 'bg-destructive/15',
            activeBg: 'bg-destructive',
            icon: <Trash2 size={18} className="text-destructive" />,
            label: 'Delete',
          }}
        >
          {row}
        </SwipeActions>
      )}

      {!selectMode && panel && (
        <ListItemBody expanded={!!panel}>
          {panel === 'docs' ? (
            <CostDocuments costItemId={item.id} groupId={groupId} onCountChange={setDocCount} />
          ) : (
            <EntityComments
              table="cost_item_comments"
              fkColumn="cost_item_id"
              entityId={item.id}
              supabase={getCurrentSupabaseClient()}
              currentUserId={currentUserId}
              memberProfiles={memberProfiles}
              onChanged={commentCount.refresh}
            />
          )}
        </ListItemBody>
      )}

      <BottomSheet open={quickSheetOpen} onOpenChange={setQuickSheetOpen} className="max-h-[76%] pb-2">
        <View className="gap-3 px-4 pb-3">
          <View className="flex-row items-center gap-2 border-b border-border pb-3">
            <CategoryChip category={item.category} />
            <Text numberOfLines={1} className="min-w-0 flex-1 font-heading text-title font-semibold text-foreground">
              {item.name}
            </Text>
            <Text className="text-sm font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {formatMoney(item.amount)}
            </Text>
          </View>

          <View className="gap-1.5">
            <Text className="text-caption font-medium text-muted-foreground">Amount</Text>
            <DragNumberField
              value={item.amount / 100}
              onChange={(value) => patch({ amount: Math.round((value ?? 0) * 100) })}
              step={1}
              min={0}
              precision={2}
              prefix={currencySymbol()}
              placeholder="0.00"
              accessibilityLabel="Amount"
            />
          </View>

          <View className="gap-1.5">
            <Text className="text-caption font-medium text-muted-foreground">Frequency</Text>
            <SegmentedControl
              options={CADENCE_SEGMENTS}
              value={item.cadence}
              onChange={(cadence) =>
                patch({
                  cadence,
                  end_date: cadence === 'one_off' ? null : item.end_date,
                  discount_end_date: cadence === 'one_off' ? null : item.discount_end_date,
                })
              }
              wrap
              size="sm"
              accessibilityLabel="Frequency"
            />
          </View>

          <View className="gap-1.5">
            <Text className="text-caption font-medium text-muted-foreground">Category</Text>
            <SearchablePicker
              options={categoryPickerOptions}
              value={item.category}
              onChange={(category) => patch({ category: category as CostCategory })}
              placeholder="Category..."
              searchPlaceholder="Search..."
              ariaLabel="Category"
            />
          </View>

          <ListGroup className="border-0 bg-transparent shadow-none">
            {docsLinked && (
              <ListItem
                onPress={() => {
                  setExpanded('docs');
                  setQuickSheetOpen(false);
                }}
              >
                <ListItemLeading>
                  <FileText size={16} className="text-muted-foreground" />
                </ListItemLeading>
                <ListItemContent>
                  <ListItemTitle>Files</ListItemTitle>
                </ListItemContent>
                <ListItemTrailing>
                  <Text className="text-caption text-muted-foreground">
                    {docCount != null && docCount > 0 ? docCount : 'Add'}
                  </Text>
                </ListItemTrailing>
              </ListItem>
            )}
            <ListItem
              onPress={() => {
                setExpanded('comments');
                setQuickSheetOpen(false);
              }}
            >
              <ListItemLeading>
                <MessageSquare size={16} className="text-muted-foreground" />
              </ListItemLeading>
              <ListItemContent>
                <ListItemTitle>Comments</ListItemTitle>
              </ListItemContent>
              <ListItemTrailing>
                <Text className="text-caption text-muted-foreground">
                  {commentCount.count > 0 ? commentCount.count : 'Add'}
                </Text>
              </ListItemTrailing>
            </ListItem>
            <ListItem
              onPress={() => {
                onEdit(item);
                setQuickSheetOpen(false);
              }}
            >
              <ListItemLeading>
                <Pencil size={16} className="text-muted-foreground" />
              </ListItemLeading>
              <ListItemContent>
                <ListItemTitle>Edit details</ListItemTitle>
              </ListItemContent>
            </ListItem>
            <ListItem
              onPress={() => {
                setQuickSheetOpen(false);
                onDelete(item);
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
        </View>
      </BottomSheet>
    </View>
  );
}
