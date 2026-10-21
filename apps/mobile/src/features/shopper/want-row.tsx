// HOUP-434: a Shopper list row (Hearth §6), shared by the Shopper screen and
// the capture sheet's search results. Leading: the Shopper tile. Content: the
// item, then its deal word in a status hue (H2, a word only) and one
// fragment. Trailing: the cheapest price over a 52px trend (H3).
// Web twin: apps/web/src/app/shopper/want-row.tsx.
import { Text, ListItem, ListItemContent, ListItemTitle, ListItemMeta, ListItemTrailing, LeadingTile } from '@homeup/ui';
import { DEAL_META, formatMoney, hitTarget, type ShopperRowSummary } from '@homeup/core';
import { ShoppingBag } from 'lucide-react-native';
import { Sparkline, dealToneClass } from './price-chart';

export function WantRow({ row, currency, onPress }: { row: ShopperRowSummary; currency: string; onPress: () => void }) {
  const { want, verdict, trend } = row;
  const status = statusWord(row);
  const fragment =
    want.status === 'bought'
      ? want.bought_at
        ? `bought ${new Date(want.bought_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
        : 'bought'
      : want.target_cents != null && !hitTarget(want)
        ? `target ${formatMoney(want.target_cents, { currency })}`
        : verdict.stats && verdict.rating
          ? `usual ${formatMoney(verdict.stats.median, { currency })}`
          : want.best_store ?? null;

  return (
    <ListItem onPress={onPress}>
      <LeadingTile sectionId="shopper" Icon={ShoppingBag} size="md" />
      <ListItemContent>
        <ListItemTitle numberOfLines={1}>{want.title}</ListItemTitle>
        <ListItemMeta>
          <Text numberOfLines={1} className="text-caption text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {status && <Text className={`text-caption font-medium ${status.className}`}>{status.text}</Text>}
            {status && fragment ? ' · ' : ''}
            {fragment}
          </Text>
        </ListItemMeta>
      </ListItemContent>
      <ListItemTrailing className="flex-col items-end gap-1">
        <Text className="text-sm font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {want.best_cents != null ? formatMoney(want.best_cents, { currency }) : ''}
        </Text>
        {want.status !== 'bought' && <Sparkline series={trend} rating={verdict.rating} />}
      </ListItemTrailing>
    </ListItem>
  );
}

function statusWord(row: ShopperRowSummary): { text: string; className: string } | null {
  const { want, verdict } = row;
  if (want.status === 'bought') return null;
  if (want.status === 'idea') return { text: 'Idea', className: 'text-muted-foreground' };
  if (want.best_cents == null) return { text: want.last_checked_at ? 'No prices found' : 'Checking', className: 'text-muted-foreground' };
  if (hitTarget(want)) return { text: 'Hit target', className: 'text-success' };
  if (!verdict.rating) return null;
  return { text: DEAL_META[verdict.rating].label, className: dealToneClass(verdict.rating) };
}
