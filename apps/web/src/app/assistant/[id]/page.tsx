'use client';

// HOUP-443: one Assistant conversation. `new` starts a quick ask or chat (an
// ask from the list or the + sheet arrives as ?ask= and is sent at once),
// `household` opens the shared thread, anything else is a conversation id.
// Replies render core's Markdown subset; changes under "Ask first" arrive as
// proposal cards with one primary action (PC). Native twin:
// apps/mobile/src/app/(tabs)/assistant/[id].tsx.
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, ArrowLeft, Pin, PinOff, Trash2 } from 'lucide-react';
import { archiveConversation, conversationTitle, deleteConversation, unarchiveConversation, useAssistantThread, useModules } from '@homeup/core';
import { archiveToast } from '@/lib/archive-toast';
import { useDataCache } from '@/lib/data-cache';
import { assistantApi } from '@/lib/assistant-client';
import { navLinkClickHandler } from '@/lib/view-transitions';
import { ThreadFooter, ThreadMessages } from '../thread-body';
import { devicePosition } from '@/lib/device-position';

const pageToast = { error: (m: string) => toast.error(m), message: (m: string) => toast(m) };

export default function AssistantThreadPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const { isOnline } = useDataCache();
  const isNew = id === 'new';
  // A reply that lands after this page was left goes to the banner host instead.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const thread = useAssistantThread(
    { id, kind: search.get('kind') === 'chat' ? 'chat' : 'quick' },
    {
      api: assistantApi,
      // In view is read; a hidden tab gets the push and reads it on return.
      presence: () => (!mounted.current ? 'away' : document.visibilityState === 'visible' ? 'here' : 'background'),
      toast: pageToast,
      here: devicePosition,
    }
  );
  const { conversation, kind, send } = thread;

  // A new conversation takes its id in the address once it has one.
  const conversationId = conversation?.id;
  useEffect(() => {
    if (isNew && conversationId) router.replace(`/assistant/${conversationId}`, { scroll: false });
  }, [isNew, conversationId, router]);

  // An ask handed over from the list or the + sheet goes out once.
  const sentAsk = useRef(false);
  useEffect(() => {
    const ask = search.get('ask');
    if (!isNew || !ask || sentAsk.current) return;
    sentAsk.current = true;
    void send(ask);
  }, [isNew, search, send]);

  // Coming back to a tab that got its answer while hidden reads it.
  useEffect(() => {
    if (!conversationId) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void assistantApi.markRead(conversationId).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [conversationId]);

  const title = conversation ? conversationTitle(conversation) : kind === 'household' ? 'Household' : kind === 'chat' ? 'New chat' : isNew ? 'Quick ask' : '';
  const own = conversation && conversation.kind !== 'household';
  const canArchive = useModules().server('assistant.archive');
  const leave = (gone: boolean) => gone && router.replace(conversation?.archived ? '/assistant/archived' : '/assistant');

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-3xl flex-col p-4 pb-24 md:p-6">
      <div className="flex items-center gap-1">
        <Link
          href="/assistant"
          aria-label="Back"
          className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={navLinkClickHandler('back', router, '/assistant')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <p className="min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</p>
        {own && (
          <>
            <button
              type="button"
              onClick={() => void thread.togglePin()}
              aria-label={conversation.kind === 'quick' ? 'Keep as a chat' : conversation.pinned ? 'Unpin' : 'Pin'}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {conversation.pinned ? <PinOff className="h-4.5 w-4.5" /> : <Pin className="h-4.5 w-4.5" />}
            </button>
            {canArchive && (
              <button
                type="button"
                onClick={() =>
                  void (conversation.archived
                    ? unarchiveConversation(assistantApi, conversation, archiveToast).then(() => thread.reload({ quiet: true }))
                    : archiveConversation(assistantApi, conversation, archiveToast).then(leave))
                }
                aria-label={conversation.archived ? 'Move back to chats' : 'Archive'}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {conversation.archived ? <ArchiveRestore className="h-4.5 w-4.5" /> : <Archive className="h-4.5 w-4.5" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => void (canArchive ? deleteConversation(assistantApi, conversation, archiveToast) : thread.remove()).then(leave)}
              aria-label="Delete conversation"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
            >
              <Trash2 className="h-4.5 w-4.5" />
            </button>
          </>
        )}
      </div>

      <ThreadMessages thread={thread} className="flex-1" />

      <ThreadFooter thread={thread} offline={!isOnline} autoFocus={isNew && !search.get('ask')} onFresh={() => router.replace('/assistant/new?kind=quick')} className="sticky bottom-20 md:bottom-4" />
    </div>
  );
}
