// HOUP-123: native port of apps/web/src/components/entity-comments.tsx. State
// (load/add/delete, optimistic with rollback) lives in @homeup/core's
// useEntityComments — shared with the web component so the two platforms
// never fork comment CRUD, only markup. Takes `supabase` as a prop (mirrors
// @homeup/core/documents.ts's injectable-client convention) so this stays
// decoupled from either platform's client singleton.
import * as React from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { Send, Trash2 } from 'lucide-react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import { timeAgo, useEntityComments } from '@homeup/core';
import { cn } from '../lib/cn';
import { Input } from './input';
import { Button } from './button';

type MemberProfiles = Record<string, { email: string; name: string | null; avatar: string | null }>;

export interface EntityCommentsProps {
  /** Comments table, e.g. "household_task_comments" */
  table: string;
  /** Foreign-key column on that table, e.g. "household_task_id" */
  fkColumn: string;
  /** The parent entity's id. */
  entityId: string;
  supabase: SupabaseClient;
  currentUserId: string | null | undefined;
  memberProfiles: MemberProfiles;
  onChanged?: () => void;
  className?: string;
}

export function EntityComments({
  table,
  fkColumn,
  entityId,
  supabase,
  currentUserId,
  memberProfiles,
  onChanged,
  className,
}: EntityCommentsProps) {
  const target = React.useMemo(() => ({ table, fkColumn, entityId }), [table, fkColumn, entityId]);
  const { comments, loading, submitting, error, addComment, removeComment } = useEntityComments(
    supabase,
    target,
    currentUserId,
    onChanged
  );
  const [text, setText] = React.useState('');

  const handleSubmit = async () => {
    const content = text.trim();
    if (!content) return;
    setText('');
    const ok = await addComment(content);
    if (!ok) setText(content);
  };

  const getDisplayName = (userId: string) => {
    if (userId === currentUserId) return 'You';
    const profile = memberProfiles[userId];
    if (profile?.name) return profile.name;
    if (profile?.email) return profile.email.split('@')[0];
    return 'User';
  };

  return (
    <View className={cn('gap-3', className)}>
      <View className="flex-row items-center gap-2">
        <Input
          value={text}
          onChangeText={setText}
          placeholder="Add a comment…"
          className="flex-1"
          editable={!submitting}
          onSubmitEditing={handleSubmit}
          returnKeyType="send"
        />
        <Button
          size="icon-sm"
          onPress={handleSubmit}
          disabled={submitting || !text.trim()}
          accessibilityLabel="Post comment"
        >
          <Send size={14} className="text-primary-foreground" />
        </Button>
      </View>

      {error && <Text className="text-caption text-destructive">{error}</Text>}

      {loading ? (
        <View className="items-center py-4">
          <ActivityIndicator />
        </View>
      ) : comments.length === 0 ? (
        <Text className="text-center text-caption text-muted-foreground">
          No comments yet. Be the first to add one.
        </Text>
      ) : (
        <View className="gap-2">
          {comments.map((comment) => {
            const avatar = memberProfiles[comment.user_id]?.avatar ?? null;
            const name = getDisplayName(comment.user_id);
            return (
              <View key={comment.id} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <View className="mb-1.5 flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2">
                    {avatar ? (
                      <Image source={{ uri: avatar }} className="h-5 w-5 rounded-full" />
                    ) : (
                      <View className="h-5 w-5 items-center justify-center rounded-full bg-muted">
                        <Text className="text-[10px] font-bold uppercase text-muted-foreground">
                          {name.charAt(0)}
                        </Text>
                      </View>
                    )}
                    <Text className="text-caption font-medium text-foreground">{name}</Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Text className="text-caption text-muted-foreground">{timeAgo(comment.created_at)}</Text>
                    {comment.user_id === currentUserId && (
                      <Pressable
                        onPress={() => void removeComment(comment.id)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Delete comment"
                      >
                        <Trash2 size={12} className="text-muted-foreground" />
                      </Pressable>
                    )}
                  </View>
                </View>
                <Text className="pl-7 text-caption text-muted-foreground">{comment.content}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
