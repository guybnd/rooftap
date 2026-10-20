// HOUP-78: native port of apps/web/src/components/apartment-comments.tsx — a
// newest-first comment thread for an apartment listing: avatar/name/relative
// timestamp per comment, a post input + send button, and per-comment delete
// restricted to the comment's own author. Reuses @homeup/core's
// apartmentComments$ Legend-State store verbatim (offline-first CRUD) rather
// than packages/ui's EntityComments — that's a separate Supabase-live
// comment primitive (used by household tasks); this ticket's spec calls for
// the same store-backed pattern web's apartment-comments.tsx uses. Relative
// timestamps reuse @homeup/core's shared timeAgo() (relative-time.ts) rather
// than a hand-rolled formatter, per Hearth's "relative dates" convention —
// it already backs packages/ui/entity-comments.tsx, so this stays
// consistent with that. Rendered as a plain View list, not ListGroup/
// ListItem — a chat-style thread doesn't fit the three-slot line-item
// anatomy.
//
// Hearth v2 pass (mirrors web): Title-step heading with a muted count, and
// the thread is one rounded-3xl Card of divided rows (H4) rather than a
// stack of bordered cards.
import * as React from 'react';
import { Image, Pressable, View } from 'react-native';
import { use$ } from '@legendapp/state/react';
import { MessageSquare, Send, Trash2 } from 'lucide-react-native';
import { Text, Button, Card, Input } from '@homeup/ui';
import {
  apartmentComments$,
  createdAtSortValue,
  timeAgo,
  useReconnectSync,
  useStoreHelpers,
  type ApartmentComment,
} from '@homeup/core';
import { useDataCache } from '@/lib/data-cache';
import { randomUUID } from '@/lib/uuid';

export function ApartmentComments({ apartmentId }: { apartmentId: string }) {
  const { memberProfiles, currentUserId, group } = useDataCache();
  const groupId = group?.id;

  const comments$ = apartmentComments$(groupId);
  useReconnectSync(comments$);
  const { writeRow, softDeleteRow } = useStoreHelpers(comments$, currentUserId);

  const [newComment, setNewComment] = React.useState('');

  const comments = use$(() =>
    Object.values(comments$.get() ?? {})
      .filter((c): c is ApartmentComment => !!c && !c.deleted && c.apartment_id === apartmentId)
      .sort((a, b) => createdAtSortValue(b.created_at) - createdAtSortValue(a.created_at))
  );

  const handleSubmit = () => {
    const content = newComment.trim();
    if (!content || !currentUserId || !groupId) return;
    writeRow({
      id: randomUUID(),
      group_id: groupId,
      apartment_id: apartmentId,
      user_id: currentUserId,
      content,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
      deleted: false,
    });
    setNewComment('');
  };

  const getDisplayName = (userId: string) => {
    if (userId === currentUserId) return 'You';
    const profile = memberProfiles[userId];
    if (profile?.name) return profile.name;
    if (profile?.email) return profile.email.split('@')[0];
    return 'User';
  };

  const getAvatar = (userId: string) => memberProfiles[userId]?.avatar ?? null;

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <MessageSquare size={16} className="text-muted-foreground" />
        <Text className="text-title text-foreground">Comments</Text>
        {comments.length > 0 && (
          <Text className="text-sm text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
            {comments.length}
          </Text>
        )}
      </View>

      <View className="flex-row items-center gap-2">
        <Input
          value={newComment}
          onChangeText={setNewComment}
          placeholder="Add a comment"
          className="flex-1"
          onSubmitEditing={handleSubmit}
          returnKeyType="send"
        />
        <Button size="sm" onPress={handleSubmit} disabled={!newComment.trim()} accessibilityLabel="Post comment">
          <Send size={14} className="text-primary-foreground" />
          Post
        </Button>
      </View>

      {comments.length === 0 ? (
        <Text className="py-1 text-sm text-muted-foreground">No comments yet.</Text>
      ) : (
        <Card className="gap-0 rounded-3xl py-0">
          {comments.map((comment, index) => {
            const avatar = getAvatar(comment.user_id);
            const name = getDisplayName(comment.user_id);
            const own = comment.user_id === currentUserId;
            return (
              <View key={comment.id} className={index > 0 ? 'border-t border-border/60 px-4 py-3' : 'px-4 py-3'}>
                <View className="mb-1 flex-row items-center justify-between gap-2">
                  <View className="min-w-0 flex-1 flex-row items-center gap-2">
                    {avatar ? (
                      <Image source={{ uri: avatar }} className="h-5 w-5 rounded-full" />
                    ) : (
                      <View className="h-5 w-5 items-center justify-center rounded-full bg-muted-foreground/20">
                        <Text className="text-[10px] font-bold uppercase text-muted-foreground">
                          {name.charAt(0)}
                        </Text>
                      </View>
                    )}
                    <Text numberOfLines={1} className="text-sm font-medium text-foreground">{name}</Text>
                  </View>
                  <View className="flex-row items-center gap-1">
                    <Text className="text-xs text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                      {timeAgo(comment.created_at)}
                    </Text>
                    {own && (
                      <Pressable
                        onPress={() => softDeleteRow(comment.id)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Delete comment"
                        className="-mr-2 h-8 w-8 items-center justify-center rounded-md active:bg-muted"
                      >
                        <Trash2 size={14} className="text-muted-foreground" />
                      </Pressable>
                    )}
                  </View>
                </View>
                <Text className="pl-7 text-sm text-foreground/85">{comment.content}</Text>
              </View>
            );
          })}
        </Card>
      )}
    </View>
  );
}
