'use client';

// HOUP-443: the Assistant space. The Hero counts the changes waiting on your
// OK (H1); the ask field sits on the list it starts (H5); then the pinned
// Household thread, your chats, open quick asks and earlier ones, each row a
// three-slot line item (H6). Native twin:
// apps/mobile/src/app/(tabs)/assistant/index.tsx.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, ChevronRight, Plus } from 'lucide-react';
import {
  AssistantApiError,
  conversationTitle,
  formatCents,
  groupConversations,
  minutesLeft,
  onConversationsChanged,
  openAssistantPopup,
  sectionHue,
  setAssistantPending,
  setAssistantUnread,
  timeAgo,
  type AssistantConversation,
  type AssistantErrorCode,
  type AssistantStatus,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { assistantApi } from '@/lib/assistant-client';
import { HeroLede } from '@/components/ui/hero-lede';
import { LeadingTile } from '@/components/ui/leading-tile';
import { ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { Pill } from '@/components/ui/pill';
import { OfflineHint } from '@/components/offline-hint';
import { SettingsLabel } from '@/components/settings-panel';
import { Composer } from './assistant-parts';
import { AssistantNotice } from './assistant-notice';
import { ConversationRow } from './conversation-row';
import { useDesktopShell, useWideLayout } from '@/lib/desktop-layout';
import { cn } from '@/lib/utils';

export default function AssistantPage() {
  const router = useRouter();
  const wide = useWideLayout();
  const shell = useDesktopShell();
  const { group, isOnline } = useDataCache();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [conversations, setConversations] = useState<AssistantConversation[] | null>(null);
  const [archived, setArchived] = useState(0);
  const [blocked, setBlocked] = useState<AssistantErrorCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await assistantApi.status();
      setStatus(s);
      if (s.access === 'none') return setBlocked('assistant_requires_plus');
      if (!s.ready) setBlocked('assistant_not_configured');
      const { conversations: list, archived: archivedCount } = await assistantApi.conversationList();
      setConversations(list);
      setArchived(archivedCount);
      setAssistantUnread(list.filter((c) => c.unread).length);
      setAssistantPending(s.pending);
      setError(null);
    } catch (err) {
      if (err instanceof AssistantApiError && err.code) setBlocked(err.code);
      else setError(err instanceof Error ? err.message : 'Could not load the assistant.');
    }
  }, []);

  useEffect(() => {
    if (group?.id && isOnline) void load();
  }, [group?.id, isOnline, load]);

  // An archive, delete or Undo anywhere (a row, the pop-up, a thread) reloads the list.
  useEffect(() => onConversationsChanged(() => void load()), [load]);

  const groups = useMemo(() => groupConversations(conversations ?? []), [conversations]);

  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;

  // Hearth §13.7 (Guy, 2026-10-22): under the desktop top bar a chat opens
  // in the docked pop-up, Messenger style, and the page stays the list.
  const ask = (text: string) => {
    if (!(shell && openAssistantPopup({ ask: text }))) router.push(`/assistant/new?kind=quick&ask=${encodeURIComponent(text)}`);
    return true;
  };
  const rowProps = (c: AssistantConversation | null, href: string) => ({
    ...(shell && c ? { onSelect: () => openAssistantPopup({ conversationId: c.id }) || router.push(href) } : { href }),
    onChanged: () => void load(),
  });

  const caption = [
    `${groups.chats.length} ${groups.chats.length === 1 ? 'chat' : 'chats'}`,
    status && status.spentCents > 0 ? `${formatCents(status.spentCents)} this month` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={cn('mx-auto space-y-4 p-4 md:p-6 pb-24', wide ? 'max-w-[1400px] lg:px-8' : 'max-w-3xl')}>
      <HeroLede
        layout="inline"
        value={status?.pending ?? 0}
        label="waiting on your OK"
        caption={caption}
        trailing={
          <>
            {!isOnline && <OfflineHint />}
            <Link
              href="/assistant/new?kind=chat"
              className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
            >
              <Plus className="h-4 w-4" />
              New chat
            </Link>
          </>
        }
      />

      {blocked === 'assistant_requires_plus' || blocked === 'assistant_not_configured' ? (
        <AssistantNotice code={blocked} />
      ) : (
        <>
          <div className={cn('space-y-4', wide && 'max-w-3xl')}>
          <Composer placeholder="Ask Rooftap anything" disabled={!isOnline} onSend={ask} />
          {error && <p className="px-1 text-sm text-destructive">{error}</p>}
          {blocked && <AssistantNotice code={blocked} />}

          <ListGroup>
            <ConversationRow conversation={groups.household} {...rowProps(groups.household, '/assistant/household')} />
          </ListGroup>
          </div>

          {/* Hearth §13.7 "Desktop shell": on a wide screen Chats, Quick asks
              and Earlier sit side by side. */}
          <div className={wide ? 'grid grid-cols-2 items-start gap-5 xl:grid-cols-3' : 'space-y-4'}>
          {groups.chats.length > 0 && (
            <div className="space-y-2">
              <SettingsLabel>Chats</SettingsLabel>
              <ListGroup>
                {groups.chats.map((c) => (
                  <ConversationRow key={c.id} conversation={c} {...rowProps(c, `/assistant/${c.id}`)} />
                ))}
              </ListGroup>
            </div>
          )}

          {groups.open.length > 0 && (
            <div className="space-y-2">
              <SettingsLabel>Quick asks</SettingsLabel>
              <ListGroup>
                {groups.open.map((c) => (
                  <ConversationRow key={c.id} conversation={c} {...rowProps(c, `/assistant/${c.id}`)} />
                ))}
              </ListGroup>
            </div>
          )}

          {groups.earlier.length > 0 && (
            <div className="space-y-2">
              <SettingsLabel>Earlier</SettingsLabel>
              <ListGroup>
                {groups.earlier.slice(0, 20).map((c) => (
                  <ConversationRow key={c.id} conversation={c} {...rowProps(c, `/assistant/${c.id}`)} />
                ))}
              </ListGroup>
            </div>
          )}
          </div>

          {archived > 0 && (
            <ListGroup className={cn(wide && 'max-w-3xl')}>
              <ListItem asChild>
                <Link href="/assistant/archived">
                  <ListItemLeading>
                    <span className="flex size-9 items-center justify-center rounded-[11px] bg-muted">
                      <Archive className="size-[18px]" />
                    </span>
                  </ListItemLeading>
                  <ListItemContent>
                    <ListItemTitle>Archived</ListItemTitle>
                    <ListItemMeta>{archived === 1 ? '1 chat' : `${archived} chats`}</ListItemMeta>
                  </ListItemContent>
                  <ListItemTrailing>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </ListItemTrailing>
                </Link>
              </ListItem>
            </ListGroup>
          )}
        </>
      )}
    </div>
  );
}
