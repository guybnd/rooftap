// Rooftap Assistant: one conversation as a three-slot line item (H6), shared
// by the Assistant space and the pop-up chat's list of chats.
// Web twin: apps/web/src/app/assistant/conversation-row.tsx.
import * as React from 'react';
import { View } from 'react-native';
import { MessageCircle, Users, Zap } from 'lucide-react-native';
import { LeadingTile, ListItem, ListItemContent, ListItemMeta, ListItemTitle, ListItemTrailing, Pill, Text, useThemeMaterial } from '@homeup/ui';
import { conversationTitle, minutesLeft, sectionHueSwatch, timeAgo, type AssistantConversation } from '@homeup/core';

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
  return (
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
}
