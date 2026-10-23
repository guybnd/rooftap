'use client';

// The chats this person archived. Each row opens its chat; the right-click
// menu moves it back to the chats or deletes it. Talking in an archived chat
// also moves it back. Native twin: apps/mobile/src/app/assistant/archived.tsx.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useArchivedConversations } from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { assistantApi } from '@/lib/assistant-client';
import { navLinkClickHandler } from '@/lib/view-transitions';
import { ListGroup } from '@/components/ui/list-item';
import { ConversationRow } from '../conversation-row';

export default function ArchivedChatsPage() {
  const router = useRouter();
  const { group, isOnline } = useDataCache();
  const { list, error, load } = useArchivedConversations(assistantApi, !!group?.id && isOnline);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24 md:p-6">
      <div className="flex items-center gap-1">
        <Link
          href="/assistant"
          aria-label="Back"
          className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={navLinkClickHandler('back', router, '/assistant')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <p className="min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Archived chats</p>
      </div>
      {error && <p className="px-1 text-sm text-destructive">{error}</p>}
      {list && list.length === 0 && <p className="px-1 text-sm text-muted-foreground">Nothing archived. Archive a chat from its menu to tidy the list.</p>}
      {list && list.length > 0 && (
        <ListGroup>
          {list.map((c) => (
            <ConversationRow key={c.id} conversation={c} href={`/assistant/${c.id}`} onChanged={() => void load()} />
          ))}
        </ListGroup>
      )}
    </div>
  );
}
