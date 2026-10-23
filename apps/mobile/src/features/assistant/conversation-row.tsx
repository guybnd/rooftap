// Rooftap Assistant: one conversation as a three-slot line item (H6), shared
// by the Assistant space and the pop-up chat's list of chats.
// Swipe right archives a chat (or moves an archived one back), swipe left
// deletes it with Undo. The Household thread is everyone's, so it doesn't
// swipe. Web twin: apps/web/src/app/assistant/conversation-row.tsx.
import * as React from 'react';
import { View } from 'react-native';
import { Archive, ArchiveRestore, MessageCircle, Trash2, Users, Zap } from 'lucide-react-native';
import { LeadingTile, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing, Pill, SwipeActions, Text, haptics, useThemeMaterial } from '@homeup/ui';
import {
  archiveConversation,
  canArchiveConversation,
  conversationRowMeta,
  conversationTitle,
  deleteConversation,
  sectionHueSwatch,
  unarchiveConversation,
  useModules,
  type AssistantConversation,
} from '@homeup/core';
import { assistantApi } from '@/features/assistant/assistant-api';
import { archiveToast } from '@/lib/archive-toast';

export function ConversationRow({
  conversation,
  onPress,
  current,
}: {
  conversation: AssistantConversation | null;
  onPress: () => void;
  /** The conversation already on show (the pop-up's list). */
  current?: boolean;
}) {
  const { scheme } = useThemeMaterial();
  // Archiving, and taking a delete back, need a server that has them.
  const canArchive = useModules().server('assistant.archive') && canArchiveConversation(conversation);
  const kind = conversation?.kind ?? 'household';
  const Icon = kind === 'household' ? Users : kind === 'quick' ? Zap : MessageCircle;
  const meta = conversationRowMeta(conversation, current);
  const row = (
    <ListItem onPress={onPress}>
      {kind === 'household' ? (
        <LeadingTile sectionId="assistant" Icon={Icon} size="md" />
      ) : (
        <View className="size-9 items-center justify-center rounded-[11px] bg-muted">
          <Icon size={18} className="text-muted-foreground" />
        </View>
      )}
      <ListItemContent>
        <ListItemTitle numberOfLines={1} className={conversation?.unread ? 'font-semibold' : undefined}>
          {conversation ? conversationTitle(conversation) : 'Household'}
        </ListItemTitle>
        {meta && (
          <ListItemMeta>
            <Text className="text-caption text-muted-foreground">{meta}</Text>
          </ListItemMeta>
        )}
      </ListItemContent>
      {conversation && (conversation.pending > 0 || conversation.unread) && (
        <ListItemTrailing>
          {conversation.pending > 0 ? (
            <Pill variant="primary">{`${conversation.pending} to OK`}</Pill>
          ) : (
            <View
              accessibilityLabel="New answer"
              className="size-2.5 rounded-full"
              style={{ backgroundColor: sectionHueSwatch('assistant', scheme).glow }}
            />
          )}
        </ListItemTrailing>
      )}
    </ListItem>
  );
  if (!conversation || !canArchive) return row;
  const archived = !!conversation.archived;
  return (
    <SwipeActions
      onSwipeRight={() => void (archived ? unarchiveConversation : archiveConversation)(assistantApi, conversation, archiveToast)}
      onSwipeLeft={() => {
        haptics.remove();
        void deleteConversation(assistantApi, conversation, archiveToast);
      }}
      right={{
        bg: 'bg-muted',
        activeBg: 'bg-foreground/15',
        icon: archived ? <ArchiveRestore size={18} className="text-foreground" /> : <Archive size={18} className="text-foreground" />,
        label: archived ? 'Move back' : 'Archive',
      }}
      left={{
        bg: 'bg-destructive/15',
        activeBg: 'bg-destructive',
        icon: <Trash2 size={18} className="text-destructive" />,
        label: 'Delete',
      }}
    >
      {row}
    </SwipeActions>
  );
}
