'use client';

// Bin night: which bins go out tonight, and whose turn it is. The Hero is
// the next collection day (H1); under it, tonight's card when it is bin night
// (marking the bins out), the next two weeks as a strip of lid marks, the
// coming collections with whose turn each one is, the council's changes, and
// the bins themselves. "Edit days" opens the setup sheet: typed in, read from
// the council calendar, or from Home Assistant.
// Native twin: apps/mobile/src/app/(tabs)/bins/index.tsx.
import { useMemo, useState } from 'react';
import { Check, Pencil, Trash2, Undo2, X } from 'lucide-react';
import {
  BIN_DAY_LETTERS,
  binCadenceLabel,
  binChangeMeta,
  binChangeTitle,
  binCollectionMeta,
  binCollectionWhen,
  binNamesPhrase,
  binTurn,
  dialog,
  useBins,
  useBinsScreen,
  weekdayOfISO,
  type BinCollection,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { HeroLede } from '@/components/ui/hero-lede';
import { ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { OfflineHint } from '@/components/offline-hint';
import { BinLids, BinLidMark } from '@/components/bin-lids';
import { memberLabel } from '@/app/setup/member-label';
import { AvatarBubble } from '@/app/home/hub-shared';
import { toastUndoAction } from '@/lib/undo-toast';
import { useWideLayout } from '@/lib/desktop-layout';
import { cn } from '@/lib/utils';
import { BinSetupSheet } from './setup-sheet';

const MICRO = 'px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground';

export default function BinsPage() {
  const { group, currentUserId, groupMembers, memberProfiles, isOnline, loading: cacheLoading } = useDataCache();
  const bins = useBins(group?.id, currentUserId);
  const wide = useWideLayout();
  const [setupOpen, setSetupOpen] = useState(false);

  const { streams, changes, plan, night } = bins;
  const screen = useBinsScreen(bins, currentUserId, (id) => memberLabel(id, memberProfiles));
  const { today, upcoming, stripDays, comingChanges, streamName, who, lede } = screen;

  if (cacheLoading || (!bins.loaded && streams.length === 0)) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;


  const collection = night.collection;
  const markOut = () => screen.markOut((undo) => toastUndoAction('Bins out', undo));

  return (
    <div className={cn('mx-auto space-y-4 p-4 md:p-6 pb-24', wide ? 'max-w-[1400px] lg:px-8' : 'max-w-3xl')}>
      <HeroLede
        layout="inline"
        value={lede.value}
        label={collection ? 'next collection' : undefined}
        caption={lede.caption}
        trailing={
          <>
            {!isOnline && <OfflineHint />}
            {streams.length > 0 && (
              <button
                type="button"
                onClick={() => setSetupOpen(true)}
                aria-label="Edit days"
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-muted px-3.5 text-sm font-medium text-foreground hover:bg-accent"
              >
                <Pencil className="h-4 w-4" />
                <span className="hidden sm:inline">Edit days</span>
              </button>
            )}
          </>
        }
      />

      {streams.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title="No bin days yet"
          description="Tell Rooftap which bins go out on which day, or let it read your council's calendar. You get a nudge the night before."
          action={{ label: 'Set up bin night', onClick: () => setSetupOpen(true), icon: <Pencil className="h-4 w-4" /> }}
        />
      ) : (
        <div className={cn(wide ? 'grid grid-cols-2 items-start gap-5' : 'space-y-4')}>
          <div className="space-y-4">
            {collection && night.tonight && (
              <ListGroup>
                <ListItem className="gap-3 py-3">
                  <ListItemLeading>
                    <BinLids lids={collection.streams.map((s) => s.lid)} />
                  </ListItemLeading>
                  <ListItemContent>
                    <ListItemTitle>{night.out ? 'Bins are out' : 'Bins out tonight'}</ListItemTitle>
                    <ListItemMeta>
                      <span className="truncate">
                        {night.out && plan?.out_by
                          ? `${who(plan.out_by)} put them out`
                          : `${binNamesPhrase(collection.streams)}, collected tomorrow morning`}
                      </span>
                    </ListItemMeta>
                  </ListItemContent>
                  <ListItemTrailing>
                    {night.out ? (
                      <Button variant="ghost" size="sm" onClick={() => bins.undoOut()}>
                        <Undo2 className="h-4 w-4" />
                        Undo
                      </Button>
                    ) : (
                      <Button size="sm" onClick={markOut}>
                        <Check className="h-4 w-4" />
                        They&apos;re out
                      </Button>
                    )}
                  </ListItemTrailing>
                </ListItem>
              </ListGroup>
            )}

            <div className="space-y-1.5">
              <p className={MICRO}>Next two weeks</p>
              <div className="space-y-1 rounded-3xl bg-card p-3">
                {stripDays.map((week, w) => (
                  <div key={w} className="grid grid-cols-7 gap-1 text-center">
                    {week.map(({ date, collection: day }) => (
                      <div
                        key={date}
                        className={cn(
                          'flex min-h-[54px] flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] text-muted-foreground',
                          day && 'bg-muted text-foreground',
                        )}
                        title={day ? binNamesPhrase(day.streams) : undefined}
                      >
                        <span className={cn(date === today && 'font-semibold text-primary')}>{BIN_DAY_LETTERS[weekdayOfISO(date)]}</span>
                        <span className="font-mono text-[10px] tabular-nums">{Number(date.slice(8))}</span>
                        {day && <BinLids lids={day.streams.map((s) => s.lid)} size="sm" stacked />}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className={MICRO}>Coming up</p>
              <ListGroup>
                {upcoming.map((c) => (
                  <CollectionRow
                    key={c.date}
                    collection={c}
                    today={today}
                    turn={binTurn(plan, c.date)}
                    profiles={memberProfiles}
                    turnLabel={who}
                  />
                ))}
              </ListGroup>
            </div>
          </div>

          <div className="space-y-4">
            {comingChanges.length > 0 && (
              <div className="space-y-1.5">
                <p className={MICRO}>Changes</p>
                <ListGroup>
                  {comingChanges.map((c) => (
                    <ListItem key={c.id} className="gap-3">
                      <ListItemContent>
                        <ListItemTitle>
                          <span className="truncate">
                            {binChangeTitle(c, streamName)}
                          </span>
                        </ListItemTitle>
                        <ListItemMeta>
                          <span className="truncate">{binChangeMeta(c)}</span>
                        </ListItemMeta>
                      </ListItemContent>
                      <ListItemTrailing>
                        <button
                          type="button"
                          aria-label="Remove change"
                          onClick={async () => {
                            if (await dialog.confirm({ title: 'Remove this change?', message: 'The usual day applies again.', confirmLabel: 'Remove', destructive: true })) bins.removeChange(c.id);
                          }}
                          className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </ListItemTrailing>
                    </ListItem>
                  ))}
                </ListGroup>
              </div>
            )}

            <div className="space-y-1.5">
              <p className={MICRO}>Your bins</p>
              <ListGroup>
                {streams.map((s) => (
                  <ListItem key={s.id} asChild className="cursor-pointer gap-3 hover:bg-muted/50">
                    <button type="button" onClick={() => setSetupOpen(true)} className="text-left">
                      <ListItemLeading>
                        <BinLidMark lid={s.lid} />
                      </ListItemLeading>
                      <ListItemContent>
                        <ListItemTitle>
                          <span className="truncate">{s.name}</span>
                        </ListItemTitle>
                        <ListItemMeta>
                          <span className="truncate">{binCadenceLabel(s)}</span>
                        </ListItemMeta>
                      </ListItemContent>
                    </button>
                  </ListItem>
                ))}
              </ListGroup>
              {(plan?.rotation.length ?? 0) > 1 && (
                <p className="px-1 text-xs text-muted-foreground">
                  Taking turns: {plan!.rotation.map((id) => who(id)).join(', then ')}. Reminder at{' '}
                  <span className="font-mono tabular-nums">{plan!.remind_at}</span> the night before.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {setupOpen && (
        <BinSetupSheet
          isOpen
          onClose={() => setSetupOpen(false)}
          bins={bins}
          groupMembers={groupMembers}
          memberProfiles={memberProfiles}
          currentUserId={currentUserId}
          today={today}
        />
      )}
    </div>
  );
}

function CollectionRow({
  collection,
  today,
  turn,
  profiles,
  turnLabel,
}: {
  collection: BinCollection;
  today: string;
  turn: string | null;
  profiles: Parameters<typeof AvatarBubble>[0]['profiles'];
  turnLabel: (id: string) => string;
}) {
  const meta = binCollectionMeta(collection, turn, turnLabel);
  const [, , day] = collection.date.split('-');
  return (
    <ListItem className="gap-3">
      <ListItemLeading>
        <div className="w-9 text-center text-[10px] font-semibold uppercase leading-tight tracking-[0.04em] text-muted-foreground">
          {BIN_DAY_LETTERS[weekdayOfISO(collection.date)]}
          <b className={cn('block font-heading text-base tabular-nums text-foreground', collection.date === today && 'text-primary')}>{Number(day)}</b>
        </div>
      </ListItemLeading>
      <ListItemContent>
        <ListItemTitle>
          <span className="truncate">{binNamesPhrase(collection.streams)}</span>
        </ListItemTitle>
        {meta && (
          <ListItemMeta>
            <span className="truncate">{meta}</span>
          </ListItemMeta>
        )}
      </ListItemContent>
      <ListItemTrailing>
        <span className="text-xs text-muted-foreground">{binCollectionWhen(collection.date, today)}</span>
        <BinLids lids={collection.streams.map((s) => s.lid)} />
        {turn && <AvatarBubble userId={turn} profiles={profiles} size={22} />}
      </ListItemTrailing>
    </ListItem>
  );
}
