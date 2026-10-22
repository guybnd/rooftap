'use client';

// The household's archived Scout searches. Each row opens its search; the
// right-click menu moves it back to Shopper or deletes it.
// Native twin: apps/mobile/src/app/shopper/scout/archived.tsx.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use$ } from '@legendapp/state/react';
import { ArrowLeft } from 'lucide-react';
import { scoutRunLists, shopperSearches$, syncStoreNow, useReconnectSync, useScoutOverrides } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { navLinkClickHandler } from '@/lib/view-transitions';
import { ListGroup } from '@/components/ui/list-item';
import { ScoutRunRow } from '../../scout-run-row';

export default function ArchivedScoutPage() {
  const router = useRouter();
  const { group } = useDataCache();
  const searches$ = shopperSearches$(group?.id);
  useReconnectSync(searches$);
  useScoutOverrides();
  const runs = use$(() => Object.values(searches$.get() ?? {}));
  const { archived } = scoutRunLists(runs);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24 md:p-6">
      <div className="flex items-center gap-1">
        <Link
          href="/shopper"
          aria-label="Back to Shopper"
          className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={navLinkClickHandler('back', router, '/shopper')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <p className="min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Archived searches</p>
      </div>
      {archived.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Nothing archived. Archive a Scout search from its menu to tidy Shopper.</p>
      ) : (
        <ListGroup>
          {archived.map((run) => (
            <ScoutRunRow key={run.id} run={run} onChanged={() => syncStoreNow(searches$)} />
          ))}
        </ListGroup>
      )}
    </div>
  );
}
