'use client';

// HOUP-443: the Assistant space. The Hero counts the changes waiting on your
// OK (H1); the ask field sits on the list it starts (H5); then the pinned
// Household thread, your chats, open quick asks and earlier ones, each row a
// three-slot line item (H6). Native twin:
// apps/mobile/src/app/(tabs)/assistant/index.tsx.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import {
  AssistantApiError,
  conversationTitle,
  formatCents,
  groupConversations,
  minutesLeft,
  sectionHue,
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

export default function AssistantPage() {
  const router = useRouter();
  const { group, isOnline } = useDataCache();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [conversations, setConversations] = useState<AssistantConversation[] | null>(null);
  const [blocked, setBlocked] = useState<AssistantErrorCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await assistantApi.status();
      setStatus(s);
      if (s.access === 'none') return setBlocked('assistant_requires_plus');
      if (!s.ready) setBlocked('assistant_not_configured');
      const list = await assistantApi.conversations();
      setConversations(list);
      setAssistantUnread(list.filter((c) => c.unread).length);
      setError(null);
    } catch (err) {
      if (err instanceof AssistantApiError && err.code) setBlocked(err.code);
      else setError(err instanceof Error ? err.message : 'Could not load the assistant.');
    }
  }, []);

  useEffect(() => {
    if (group?.id && isOnline) void load();
  }, [group?.id, isOnline, load]);

  const groups = useMemo(() => groupConversations(conversations ?? []), [conversations]);

  if (!group) return <div className="p-6 text-muted-foreground">No group selected</div>;

  const ask = (text: string) => {
    router.push(`/assistant/new?kind=quick&ask=${encodeURIComponent(text)}`);
    return true;
  };

  const caption = [
    `${groups.chats.length} ${groups.chats.length === 1 ? 'chat' : 'chats'}`,
    status && status.spentCents > 0 ? `${formatCents(status.spentCents)} this month` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6 pb-24">
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
          <Composer placeholder="Ask Rooftap anything" disabled={!isOnline} onSend={ask} />
          {error && <p className="px-1 text-sm text-destructive">{error}</p>}
          {blocked && <AssistantNotice code={blocked} />}

          <ListGroup>
            <ConversationRow conversation={groups.household} href="/assistant/household" />
          </ListGroup>

          {groups.chats.length > 0 && (
            <div className="space-y-2">
              <SettingsLabel>Chats</SettingsLabel>
              <ListGroup>
                {groups.chats.map((c) => (
                  <ConversationRow key={c.id} conversation={c} href={`/assistant/${c.id}`} />
                ))}
              </ListGroup>
            </div>
          )}

          {groups.open.length > 0 && (
            <div className="space-y-2">
              <SettingsLabel>Quick asks</SettingsLabel>
              <ListGroup>
                {groups.open.map((c) => (
                  <ConversationRow key={c.id} conversation={c} href={`/assistant/${c.id}`} />
                ))}
              </ListGroup>
            </div>
          )}

          {groups.earlier.length > 0 && (
            <div className="space-y-2">
              <SettingsLabel>Earlier</SettingsLabel>
              <ListGroup>
                {groups.earlier.slice(0, 20).map((c) => (
                  <ConversationRow key={c.id} conversation={c} href={`/assistant/${c.id}`} />
                ))}
              </ListGroup>
            </div>
          )}
        </>
      )}
    </div>
  );
}
