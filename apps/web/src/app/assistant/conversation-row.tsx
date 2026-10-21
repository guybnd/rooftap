'use client';

// Rooftap Assistant: one conversation as a three-slot line item (H6), shared
// by the Assistant space and the pop-up chat's list of chats.
// Native twin: apps/mobile/src/features/assistant/conversation-row.tsx.
import Link from 'next/link';
import { MessageCircle, Users, Zap } from 'lucide-react';
import { conversationTitle, minutesLeft, sectionHue, timeAgo, type AssistantConversation } from '@homeup/core';
import { LeadingTile } from '@/components/ui/leading-tile';
import { ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { Pill } from '@/components/ui/pill';

export function ConversationRow({
  conversation,
  href,
  onSelect,
  current,
}: {
  conversation: AssistantConversation | null;
  /** A link (the Assistant space), or a tap handler (the pop-up's list). */
  href?: string;
  onSelect?: () => void;
  /** The conversation already on show (the pop-up's list). */
  current?: boolean;
}) {
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
  return (
    <ListItem asChild>
      {href ? (
        <Link href={href}>{body}</Link>
      ) : (
        <button type="button" onClick={onSelect} aria-current={current || undefined} className="w-full text-left">
          {body}
        </button>
      )}
    </ListItem>
  );
}
