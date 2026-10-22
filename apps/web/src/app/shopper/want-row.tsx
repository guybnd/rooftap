'use client';

// HOUP-434: a Shopper list row (Hearth §6). Leading: the Shopper tile.
// Content: the item, then its deal word in a status hue (H2, a word only) and
// one fragment. Trailing: the cheapest price over a 52px trend (H3).
// Native twin: apps/mobile/src/features/shopper/want-row.tsx.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShoppingBag } from 'lucide-react';
import { DEAL_META, formatMoney, hitTarget, type ShopperRowSummary } from '@homeup/core';
import { navLinkClickHandler } from '@/lib/view-transitions';
import { LeadingTile } from '@/components/ui/leading-tile';
import { useRowContextMenu } from '@/components/ui/row-context-menu';
import { ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { Sparkline, dealToneClass } from './price-chart';

export function WantRow({
  row,
  currency,
  onNavigate,
  onSetBought,
  onDelete,
}: {
  row: ShopperRowSummary;
  currency: string;
  onNavigate?: () => void;
  /** The row menu's Mark bought (true) or Watch again (false); omitted, it's left out. */
  onSetBought?: (bought: boolean) => void;
  onDelete?: () => void;
}) {
  const router = useRouter();
  const { want, verdict, trend } = row;
  const href = `/shopper/${want.id}`;
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

  // Hearth §13.7 "Row menu": right-click with a mouse.
  const rowMenu = useRowContextMenu(() => ({
    title: want.title,
    kind: 'Shopper item',
    actions: [
      {
        id: 'open',
        label: 'Open',
        group: 'open',
        icon: 'open',
        run: () => {
          onNavigate?.();
          router.push(href);
        },
      },
      onSetBought && {
        id: 'bought',
        label: want.status === 'bought' ? 'Watch again' : 'Mark bought',
        group: 'state',
        icon: want.status === 'bought' ? 'undo' : 'done',
        run: () => onSetBought(want.status !== 'bought'),
      },
      { id: 'copy', label: 'Copy link', group: 'share', icon: 'copy', run: () => void navigator.clipboard?.writeText(new URL(href, window.location.href).toString()) },
      onDelete && { id: 'delete', label: 'Delete', group: 'danger', icon: 'delete', danger: true, run: onDelete },
    ],
  }));

  return (
    <>
    {/* Beside the row, not in it: a click inside the menu must not reach the link. */}
    {rowMenu.menu}
    <ListItem asChild onContextMenu={rowMenu.onContextMenu}>
      <Link
        href={href}
        onClick={(e) => {
          onNavigate?.();
          navLinkClickHandler('descend', router, href)(e);
        }}
      >
        <LeadingTile sectionId="shopper" Icon={ShoppingBag} size="md" />
        <ListItemContent>
          <ListItemTitle>
            <span className="truncate">{want.title}</span>
          </ListItemTitle>
          <ListItemMeta>
            {status && <span className={status.className}>{status.text}</span>}
            {status && fragment && <span aria-hidden> · </span>}
            {fragment && <span className="tabular-nums">{fragment}</span>}
          </ListItemMeta>
        </ListItemContent>
        <ListItemTrailing className="flex-col items-end gap-1">
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {want.best_cents != null ? formatMoney(want.best_cents, { currency }) : ''}
          </span>
          {want.status !== 'bought' && <Sparkline series={trend} rating={verdict.rating} />}
        </ListItemTrailing>
      </Link>
    </ListItem>
    </>
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
