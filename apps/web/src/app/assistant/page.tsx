'use client';

// HOUP-443: the Assistant space. The Hero counts the changes waiting on your
// OK (H1); the ask field sits on the list it starts (H5); then the pinned
// Household thread, your chats, open quick asks and earlier ones, each row a
// three-slot line item (H6). Native twin:
// apps/mobile/src/app/(tabs)/assistant/index.tsx.
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, ChevronRight, Plus } from 'lucide-react';
import {
  openAssistantPopup,
  setAssistantPending,
  useAssistantSpace,
  type AssistantConversation,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { assistantApi } from '@/lib/assistant-client';
import { HeroLede } from '@/components/ui/hero-lede';
import { ModuleSettingsButton } from '@/components/module-settings-sheet';
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
  const { status, archived, blocked, error, groups, caption, hardBlock, load } = useAssistantSpace(assistantApi, {
    onStatus: (s) => setAssistantPending(s.pending),
  });

  useEffect(() => {
    if (group?.id && isOnline) void load();
  }, [group?.id, isOnline, load]);


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
            <ModuleSettingsButton moduleId="assistant" />
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

      {hardBlock && blocked ? (
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
