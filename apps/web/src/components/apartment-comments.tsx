"use client";

import { useCallback, useMemo, useState } from "react";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import { use$ } from "@legendapp/state/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDataCache } from "@/lib/data-cache";
import { apartmentComments$, useReconnectSync, useStoreHelpers } from "@homeup/core";
import type { ApartmentComment } from '@homeup/core';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

interface ApartmentCommentsProps {
  apartmentId: string;
}

export function ApartmentComments({ apartmentId }: ApartmentCommentsProps) {
  const { memberProfiles, currentUserId, group } = useDataCache();
  const groupId = group?.id;
  const comments$ = apartmentComments$(groupId);
  useReconnectSync(comments$);
  const { writeRow, softDeleteRow } = useStoreHelpers(comments$, currentUserId);
  const [newComment, setNewComment] = useState("");

  const comments = use$(() =>
    Object.values(comments$.get() ?? {})
      .filter((c): c is ApartmentComment => !!c && !c.deleted && c.apartment_id === apartmentId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  );
  const loading = useMemo(() => !groupId, [groupId]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const content = newComment.trim();
    if (!content || !currentUserId || !groupId) return;

    writeRow({
      id: crypto.randomUUID(),
      group_id: groupId,
      apartment_id: apartmentId,
      user_id: currentUserId,
      content,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
      deleted: false,
    });
    setNewComment("");
  }, [apartmentId, currentUserId, groupId, newComment, writeRow]);

  const handleDelete = useCallback((commentId: string) => {
    softDeleteRow(commentId);
  }, [softDeleteRow]);

  const getDisplayName = (userId: string) => {
    if (userId === currentUserId) return "You";
    const profile = memberProfiles[userId];
    if (profile?.name) return profile.name;
    if (profile?.email) return profile.email.split("@")[0];
    return "User";
  };

  const getAvatar = (userId: string) => {
    const profile = memberProfiles[userId];
    return profile?.avatar ?? null;
  };

  // Hearth v2 pass: Title-step heading with a muted count, the composer above
  // the thread, and the thread as one card of divided rows (H4) instead of a
  // stack of bordered cards.
  return (
    <div>
      <h2 className="mb-3 flex items-center gap-2 font-heading text-base font-semibold">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        Comments
        {comments.length > 0 && (
          <span className="font-sans text-sm font-normal tabular-nums text-muted-foreground">
            {comments.length}
          </span>
        )}
      </h2>

      <form onSubmit={handleSubmit} className="mb-3 flex gap-2">
        <Input
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add a comment"
          className="h-10 rounded-xl"
        />
        <Button
          type="submit"
          disabled={!newComment.trim()}
          className="h-10 rounded-xl px-3.5"
        >
          <Send className="h-4 w-4 mr-1.5" />
          Post
        </Button>
      </form>

      {loading ? null : comments.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          No comments yet.
        </p>
      ) : (
        <div className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[var(--card-shadow)]">
          {comments.map((comment) => {
            const avatar = getAvatar(comment.user_id);
            const name = getDisplayName(comment.user_id);
            return (
              <div
                key={comment.id}
                className="group px-4 py-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatar} alt="" className="h-5 w-5 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted-foreground/20 text-[10px] font-bold uppercase text-muted-foreground">
                        {name.charAt(0)}
                      </span>
                    )}
                    <span className="truncate text-sm font-medium">{name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {timeAgo(comment.created_at)}
                    </span>
                    {comment.user_id === currentUserId && (
                      <button
                        onClick={() => handleDelete(comment.id)}
                        className="-mr-2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-100 transition-opacity hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                        aria-label="Delete comment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="whitespace-pre-wrap pl-7 text-sm text-foreground/85">
                  {comment.content}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
