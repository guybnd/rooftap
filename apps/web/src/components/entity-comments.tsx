"use client";

import { useMemo, useState } from "react";
import { Send, Trash2, Loader2 } from "lucide-react";
import { timeAgo, useEntityComments } from "@homeup/core";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";

interface EntityCommentsProps {
  /** Comments table, e.g. "setup_item_comments" or "household_task_comments" */
  table: string;
  /** Foreign-key column on that table, e.g. "setup_item_id" or "household_task_id" */
  fkColumn: string;
  /** The parent entity's id */
  entityId: string;
  onChanged?: () => void;
}

// HOUP-123: load/add/delete state moved to @homeup/core's useEntityComments
// (shared with the native EntityComments in @homeup/ui) — this component now
// owns markup + the input's local text state only.
export function EntityComments({ table, fkColumn, entityId, onChanged }: EntityCommentsProps) {
  const { memberProfiles, currentUserId } = useDataCache();
  const supabase = createClient();
  const target = useMemo(() => ({ table, fkColumn, entityId }), [table, fkColumn, entityId]);
  const { comments, loading, submitting, error, addComment, removeComment } = useEntityComments(
    supabase,
    target,
    currentUserId,
    onChanged
  );
  const [newComment, setNewComment] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = newComment.trim();
    if (!content) return;
    setNewComment("");
    const ok = await addComment(content);
    if (!ok) setNewComment(content);
  };

  const handleDelete = (commentId: string) => {
    void removeComment(commentId);
  };

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

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add a comment... (Enter to send)"
          className="flex-1 bg-muted border border-border rounded px-3 py-2 text-sm text-foreground placeholder-muted-foreground"
          disabled={submitting}
        />
        <button
          type="submit"
          disabled={submitting || !newComment.trim()}
          className="bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground px-3 py-2 rounded text-sm flex items-center gap-1.5 transition-colors"
        >
          <Send className="h-4 w-4" />
          Post
        </button>
      </form>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">
          No comments yet. Be the first to add one.
        </p>
      ) : (
        <div className="space-y-2">
          {comments.map((comment) => {
            const avatar = getAvatar(comment.user_id);
            const name = getDisplayName(comment.user_id);
            return (
              <div
                key={comment.id}
                className="rounded border border-border bg-muted/30 px-3 py-2 group hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    {avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={avatar}
                        alt=""
                        className="h-5 w-5 rounded-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground uppercase">
                        {name.charAt(0)}
                      </span>
                    )}
                    <span className="text-xs font-medium text-foreground">{name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{timeAgo(comment.created_at)}</span>
                    {comment.user_id === currentUserId && (
                      <button
                        onClick={() => handleDelete(comment.id)}
                        className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-0.5"
                        aria-label="Delete comment"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap pl-7">
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
