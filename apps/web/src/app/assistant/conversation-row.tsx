'use client';

// Rooftap Assistant: one conversation as a three-slot line item (H6), shared
// by the Assistant space and the pop-up chat's list of chats.
// Native twin: apps/mobile/src/features/assistant/conversation-row.tsx.
import Link from 'next/link';
import { MessageCircle, Users, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  archiveConversation,
  canArchiveConversation,
  conversationTitle,
  deleteConversation,
  dialog,
  minutesLeft,
  sectionHue,
  timeAgo,
  unarchiveConversation,
  useModules,
  type AssistantConversation,
} from '@homeup/core';
import { archiveToast } from '@/lib/archive-toast';
import { assistantApi } from '@/lib/assistant-client';
import { useRowContextMenu } from '@/components/ui/row-context-menu';
import { LeadingTile } from '@/components/ui/leading-tile';
import { ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { Pill } from '@/components/ui/pill';

export function ConversationRow({
  conversation,
  href,
  onSelect,
  current,
  onChanged,
}: {
  conversation: AssistantConversation | null;
  /** A link (the Assistant space), or a tap handler (the pop-up's list). */
  href?: string;
  onSelect?: () => void;
  /** The conversation already on show (the pop-up's list). */
  current?: boolean;
  /** Reloads the list after a menu action (pin, mark read, archive, delete). */
  onChanged?: () => void;
}) {
  const router = useRouter();
  // Archiving, and taking a delete back, need a server that has them.
  const canArchive = useModules().server('assistant.archive');
  const kind = conversation?.kind ?? 'household';
  const Icon = kind === 'household' ? Users : kind === 'quick' ? Zap : MessageCircle;
  const left = conversation ? minutesLeft(conversation) : null;
  const meta = current
    ? 'Showing now'
    : kind === 'household'
      ? 'Everyone in the home'
      : left != null && left > 0
        ? `Open for ${left} min`
        : conversation
          ? timeAgo(conversation.last_active_at)
          : null;
  const body = (
    <>
        <ListItemLeading>
          {kind === 'household' ? (
            <LeadingTile sectionId="assistant" Icon={Icon} size="md" />
          ) : (
            <span className="flex size-9 items-center justify-center rounded-[11px] bg-muted">
              <Icon className="size-[18px]" />
            </span>
          )}
        </ListItemLeading>
        <ListItemContent>
          <ListItemTitle className={conversation?.unread ? 'font-semibold' : undefined}>
            {conversation ? conversationTitle(conversation) : 'Household'}
          </ListItemTitle>
          {meta && <ListItemMeta>{meta}</ListItemMeta>}
        </ListItemContent>
        {conversation && (conversation.pending > 0 || conversation.unread) && (
          <ListItemTrailing>
            {conversation.pending > 0 ? (
              <Pill variant="primary">{conversation.pending} to OK</Pill>
            ) : (
              <span
                role="img"
                aria-label="New answer"
                data-hue={sectionHue('assistant')}
                className="size-2.5 rounded-full bg-[var(--hue-glow)]"
              />
            )}
          </ListItemTrailing>
        )}
    </>
  );
  // Hearth §13.7 "Row menu": right-click with a mouse. The Household thread
  // is everyone's, so it only opens and marks read.
  const update = async (patch: { pinned?: boolean }) => {
    if (!conversation) return;
    try {
      await assistantApi.updateConversation(conversation.id, patch);
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change that chat.');
    }
  };
  const remove = async (c: AssistantConversation) => {
    if (canArchive) return void deleteConversation(assistantApi, c, archiveToast);
    // An older server can't take a delete back, so ask first.
    if (await dialog.confirm({ title: `Delete "${conversationTitle(c)}"?`, destructive: true })) {
      await assistantApi.updateConversation(c.id, { deleted: true }).then(onChanged, () => toast.error('Could not delete that chat.'));
    }
  };
  const own = canArchiveConversation(conversation);
  const rowMenu = useRowContextMenu(() =>
    conversation
      ? {
          title: conversationTitle(conversation),
          kind: kind === 'household' ? 'Household thread' : kind === 'quick' ? 'Quick ask' : 'Chat',
          actions: [
            { id: 'open', label: 'Open', group: 'open', icon: 'open', run: () => (onSelect ? onSelect() : href && router.push(href)) },
            conversation.unread && {
              id: 'read',
              label: 'Mark as read',
              group: 'state',
              icon: 'done',
              run: () => void assistantApi.markRead(conversation.id, { seen: true }).then(() => onChanged?.()),
            },
            own && !conversation.archived && {
              id: 'pin',
              label: kind === 'quick' ? 'Keep as a chat' : conversation.pinned ? 'Unpin' : 'Pin',
              group: 'set',
              icon: 'star',
              run: () => void update({ pinned: !conversation.pinned }),
            },
            own && canArchive && {
              id: 'archive',
              label: conversation.archived ? 'Move back to chats' : 'Archive',
              group: 'set',
              icon: 'archive',
              run: () =>
                void (conversation.archived ? unarchiveConversation : archiveConversation)(assistantApi, conversation, archiveToast),
            },
            own && {
              id: 'delete',
              label: 'Delete',
              group: 'danger',
              icon: 'delete',
              danger: true,
              run: () => void remove(conversation),
            },
          ],
        }
      : null
  );

  return (
    <>
    {rowMenu.menu}
    <ListItem asChild onContextMenu={rowMenu.onContextMenu}>
      {href ? (
        <Link href={href}>{body}</Link>
      ) : (
        <button type="button" onClick={onSelect} aria-current={current || undefined} className="w-full text-left">
          {body}
        </button>
      )}
    </ListItem>
    </>
  );
}
