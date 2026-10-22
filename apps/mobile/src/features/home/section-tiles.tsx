// HOUP-223: native port of apps/web/src/app/home/section-tiles.tsx — the
// smaller hub tiles (Costs, Documents, Setup, Home Search) were flattened to
// a single generic TileSpec-driven grid on mobile (HOUP-85/HOUP-172), which
// dropped every in-tile action and readout web has: Costs' "+ Add cost"
// button + tone-chip budget readout, Documents' loading skeleton + Upload
// button, Setup's per-status SegmentedBar (a plain ProgressBar collapses
// "needed" and "got it" into one number), and Home Search's second
// (top-scored-listing) row. Each tile now owns its own store read + action,
// same split as web — apps/mobile/src/app/(tabs)/home/index.tsx just renders these.
// Hearth v2: Costs & Budget and Documents left Home (Budget and Bills are
// Spaces of their own, money-spaces.tsx; Documents lives in its section).
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { use$ } from '@legendapp/state/react';
import { Hammer, LayoutDashboard, CalendarClock, Star, ChevronRight, ShoppingBag, Sparkles } from 'lucide-react-native';
import { Text, Card, LeadingTile, ListGroup } from '@homeup/ui';
import { assistantApi } from '@/features/assistant/assistant-api';
import { Sparkline } from '@/features/shopper/price-chart';
import { WantRow } from '@/features/shopper/want-row';
import {
  summarize,
  useReconnectSync,
  setupItems$,
  shopperWants$,
  shopperPriceSnapshots$,
  summarizeWants,
  sortWatching,
  isGoodNow,
  hitTarget,
  formatMoney,
  todayISO,
  useHouseholdCurrency,
  DEAL_META,
  type ShopperWant,
  type ShopperPriceSnapshot,
  type Group,
  type SetupItem,
  type Appointment,
  type ApartmentWithScore,
} from '@homeup/core';
import { SegmentedBar } from '@/features/setup/segmented-bar';
import { formatRelativeDay, formatTime12h, pad2 } from '@homeup/core';

// H4/H5: every tile is its own tap target (Pressable → Card) with one
// chevron affordance; in-tile action buttons are separate sibling Pressables
// (not nested inside the navigating one) so a tap on "Add cost"/"Upload"
// never also fires the tile's navigation — mirrors GroceriesWidget's header-
// row-vs-quick-add-row split rather than web's single stopPropagation div.
// Hearth v2: each tile leads with its section's identity tile (section-hues.ts).
export function TileHeader({ Icon, sectionId, title, right }: { Icon: typeof Hammer; sectionId: string; title: string; right?: React.ReactNode }) {
  return (
    <View className="flex-row items-center gap-2.5">
      <LeadingTile sectionId={sectionId} Icon={Icon} size="md" />
      <Text className="text-title text-foreground" numberOfLines={1}>
        {title}
      </Text>
      <View className="ml-auto flex-row items-center gap-2">
        {right}
        <ChevronRight size={14} className="text-muted-foreground" />
      </View>
    </View>
  );
}

// ── Home Setup ──────────────────────────────────────────────────────────────────
export function SetupTile({ group }: { group: Group }) {
  const router = useRouter();
  const setup$ = setupItems$(group.id);
  useReconnectSync(setup$);
  const items = use$(() => Object.values(setup$.get() ?? {}).filter((i): i is SetupItem => !!i && !i.deleted));
  const summary = summarize(items);
  const done = summary.total - summary.outstanding;

  return (
    <View className="min-w-[47%] flex-1">
      <Pressable onPress={() => router.push('/setup')} accessibilityRole="button" accessibilityLabel="Home setup">
        <Card size="sm">
          <View className="gap-2 px-4">
            <TileHeader Icon={Hammer} sectionId="setup" title="Home Setup" />
            {summary.total === 0 ? (
              <Text className="text-caption text-muted-foreground">No setup items yet.</Text>
            ) : (
              <View className="gap-2">
                <View className="flex-row items-baseline gap-2">
                  <Text className="text-title font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                    {done}/{summary.total}
                  </Text>
                  <Text className="text-caption text-muted-foreground">purchased</Text>
                </View>
                <SegmentedBar counts={summary.counts} />
              </View>
            )}
          </View>
        </Card>
      </Pressable>
    </View>
  );
}

// ── Home Search ─────────────────────────────────────────────────────────────────
export function HomeSearchTile({
  apartments,
  appointments,
}: {
  apartments: ApartmentWithScore[];
  appointments: Appointment[];
}) {
  const router = useRouter();
  const nowMs = Date.now();
  const nextAppointment =
    appointments
      .filter((a) => a.status === 'scheduled' && new Date(a.scheduled_at).getTime() >= nowMs)
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0] ?? null;

  const topListing =
    [...apartments]
      .filter((a) => !a.archived)
      .sort((a, b) => (b.score?.percentage ?? -1) - (a.score?.percentage ?? -1))[0] ?? null;

  const apptWhen = nextAppointment ? new Date(nextAppointment.scheduled_at) : null;
  const apptAddress = nextAppointment
    ? apartments.find((ap) => ap.id === nextAppointment.apartment_id)?.address ?? 'Viewing'
    : null;

  return (
    <View className="min-w-[47%] flex-1">
      <Pressable onPress={() => router.push('/homesearch')} accessibilityRole="button" accessibilityLabel="Home search">
        <Card size="sm">
          <View className="gap-2.5 px-4">
            <TileHeader Icon={LayoutDashboard} sectionId="search" title="Home Search" />
            <View className="flex-row items-start gap-2">
              <CalendarClock size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              {nextAppointment && apptWhen ? (
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-caption text-foreground">
                    {apptAddress}
                  </Text>
                  <Text className="text-[11px] text-muted-foreground">
                    {formatRelativeDay(apptWhen)} · {formatTime12h(`${pad2(apptWhen.getHours())}:${pad2(apptWhen.getMinutes())}`)}
                  </Text>
                </View>
              ) : (
                <Text className="text-caption text-muted-foreground">No upcoming viewings</Text>
              )}
            </View>
            <View className="flex-row items-start gap-2">
              <Star size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              {topListing ? (
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-caption text-foreground">
                    {topListing.address}
                  </Text>
                  <Text className="text-[11px] text-muted-foreground">
                    {topListing.score ? `${topListing.score.percentage}% match` : 'Not yet scored'}
                  </Text>
                </View>
              ) : (
                <Text className="text-caption text-muted-foreground">No listings yet</Text>
              )}
            </View>
          </View>
        </Card>
      </Pressable>
    </View>
  );
}

// ── Shopper (HOUP-434) ──────────────────────────────────────────────────────────
// How many watched items are at a good price now, and the best of them.
// Expanded (Home's Shopper shortcut filters Home to it), the Space lists every
// watched item, good prices first, each opening its own page.
export function ShopperTile({ group, expanded = false }: { group: Group; expanded?: boolean }) {
  const router = useRouter();
  const currency = useHouseholdCurrency();
  const wants$ = shopperWants$(group.id);
  const snaps$ = shopperPriceSnapshots$(group.id);
  useReconnectSync(wants$);
  useReconnectSync(snaps$);
  const wants = use$(() =>
    Object.values(wants$.get() ?? {}).filter((w): w is ShopperWant => !!w && !w.deleted && w.status === 'watching')
  );
  const snaps = use$(() =>
    Object.values(snaps$.get() ?? {}).filter((s): s is ShopperPriceSnapshot => !!s && !s.deleted)
  );
  const rows = sortWatching(summarizeWants(wants, snaps, todayISO()));
  const good = rows.filter(isGoodNow);
  const top = good[0] ?? null;

  const counts =
    rows.length > 0 ? (
      <View className="flex-row items-baseline gap-2">
        <Text className="text-title font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {good.length}
        </Text>
        <Text className="text-caption text-muted-foreground">
          {good.length === 1 ? 'good deal' : 'good deals'} · {rows.length} watching
        </Text>
      </View>
    ) : (
      <Text className="text-caption text-muted-foreground">Nothing being watched.</Text>
    );

  if (expanded) {
    return (
      <Card size="sm">
        <View className="gap-2.5 px-4">
          <Pressable onPress={() => router.push('/shopper')} accessibilityRole="button" accessibilityLabel="Open Shopper">
            <TileHeader Icon={ShoppingBag} sectionId="shopper" title="Shopper" />
          </Pressable>
          {counts}
        </View>
        {rows.length > 0 && (
          <ListGroup bordered={false} className="mx-2">
            {rows.map((row) => (
              <WantRow
                key={row.want.id}
                row={row}
                currency={currency}
                onPress={() => router.push(`/shopper/${row.want.id}`)}
              />
            ))}
          </ListGroup>
        )}
      </Card>
    );
  }

  return (
    <View className="min-w-[47%] flex-1">
      <Pressable
        onPress={() => router.push(top ? `/shopper/${top.want.id}` : '/shopper')}
        accessibilityRole="button"
        accessibilityLabel="Shopper"
      >
        <Card size="sm">
          <View className="gap-2 px-4">
            <TileHeader Icon={ShoppingBag} sectionId="shopper" title="Shopper" />
            {rows.length === 0 ? (
              counts
            ) : (
              <View className="gap-2">
                {counts}
                {top && top.want.best_cents != null && (
                  <View className="flex-row items-center gap-3">
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={1} className="text-caption text-foreground">
                        {top.want.title}
                      </Text>
                      <Text numberOfLines={1} className="text-[11px] text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                        <Text className="text-[11px] text-success">
                          {hitTarget(top.want) ? 'Hit target' : top.verdict.rating ? DEAL_META[top.verdict.rating].label : ''}
                        </Text>
                        {' · '}
                        {formatMoney(top.want.best_cents, { currency })}
                        {top.want.best_store ? ` at ${top.want.best_store}` : ''}
                      </Text>
                    </View>
                    {/* The same price trend the Shopper row carries. */}
                    <Sparkline series={top.trend} rating={top.verdict.rating} />
                  </View>
                )}
              </View>
            )}
          </View>
        </Card>
      </Pressable>
    </View>
  );
}

// ── Assistant (HOUP-443) ────────────────────────────────────────────────────────
// Only what waits on you: changes the assistant proposed that need your OK.
export function AssistantTile() {
  const router = useRouter();
  const [pending, setPending] = React.useState<number | null>(null);
  React.useEffect(() => {
    let live = true;
    assistantApi
      .status()
      .then((s) => live && setPending(s.access === 'none' || !s.ready ? null : s.pending))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return (
    <View className="min-w-[47%] flex-1">
      <Pressable onPress={() => router.push('/assistant')} accessibilityRole="button" accessibilityLabel="Assistant">
        <Card size="sm">
          <View className="gap-2 px-4">
            <TileHeader Icon={Sparkles} sectionId="assistant" title="Assistant" />
            {pending ? (
              <View className="flex-row items-baseline gap-2">
                <Text className="text-title font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                  {pending}
                </Text>
                <Text className="text-caption text-muted-foreground">{pending === 1 ? 'change waits on your OK' : 'changes wait on your OK'}</Text>
              </View>
            ) : (
              <Text className="text-caption text-muted-foreground">Ask about the week, the list or the bills.</Text>
            )}
          </View>
        </Card>
      </Pressable>
    </View>
  );
}
