import type { SupabaseClient } from "@supabase/supabase-js";
import { conversationTitle, replyPreview, type AssistantConversation, type AssistantMessage, type AssistantNotifyPrefs } from "@homeup/core";
import { sendPushToUsers, type PushDeps, type PushPayload } from "@/lib/push";

// "It answered" for the assistant: how far each member has read each
// conversation (assistant_reads), and the push that goes out when a reply
// lands after they left.
//
// A reply counts as noticed when the app marks the conversation read (the
// reply rendered on screen) or seen (it showed a banner elsewhere in the
// app). The chat route waits a short grace after answering, then pushes
// only if neither happened: the window closed, the app went to the
// background, or the phone locked while Rooftap was thinking.

export interface ReadState {
  read_at: string | null;
  seen_at: string | null;
}

interface Who {
  admin: SupabaseClient;
  userId: string;
  groupId: string;
}

/** How long the app has to show a reply before it counts as missed. */
export const NOTIFY_GRACE_MS = 8_000;

/** This person's read state for these conversations; no entry means read. */
export async function readStates(who: Who, conversationIds: string[]): Promise<Map<string, ReadState>> {
  const states = new Map<string, ReadState>();
  if (conversationIds.length === 0) return states;
  let data: unknown[] | null = null;
  try {
    ({ data } = await who.admin
      .from("assistant_reads")
      .select("conversation_id, read_at, seen_at")
      .eq("user_id", who.userId)
      .in("conversation_id", conversationIds));
  } catch (err) {
    console.error("[assistant] read states failed", err);
  }
  for (const r of (data ?? []) as (ReadState & { conversation_id: string })[]) {
    states.set(r.conversation_id, { read_at: r.read_at, seen_at: r.seen_at });
  }
  return states;
}

/** Whether a conversation last active at `lastActiveAt` has news for someone in `state`. */
export function isUnread(lastActiveAt: string, state: ReadState | undefined): boolean {
  if (!state) return false;
  return !state.read_at || Date.parse(lastActiveAt) > Date.parse(state.read_at);
}

/** Records that this person read (or, with `seen`, was shown) a conversation as of `at`. */
export async function markConversationRead(who: Who, conversationId: string, opts: { seen?: boolean; at?: Date } = {}) {
  const at = (opts.at ?? new Date()).toISOString();
  // Read state is a nicety: a server without the table (or a hiccup) never breaks a reply.
  try {
    const { error } = await who.admin
      .from("assistant_reads")
      .upsert(
        { user_id: who.userId, conversation_id: conversationId, group_id: who.groupId, ...(opts.seen ? { seen_at: at } : { read_at: at }) },
        { onConflict: "user_id,conversation_id" }
      );
    if (error) console.error("[assistant] mark read failed", error.message);
  } catch (err) {
    console.error("[assistant] mark read failed", err);
  }
}

export async function loadNotifyPrefs(admin: SupabaseClient, userId: string): Promise<AssistantNotifyPrefs> {
  const { data } = await admin.from("assistant_notify_prefs").select("replies, preview").eq("user_id", userId).maybeSingle();
  const row = data as AssistantNotifyPrefs | null;
  return { replies: row?.replies ?? true, preview: row?.preview ?? true };
}

export async function saveNotifyPrefs(admin: SupabaseClient, userId: string, patch: Partial<AssistantNotifyPrefs>): Promise<AssistantNotifyPrefs> {
  const next = { ...(await loadNotifyPrefs(admin, userId)), ...patch };
  const { error } = await admin
    .from("assistant_notify_prefs")
    .upsert({ user_id: userId, replies: next.replies, preview: next.preview, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  return next;
}

/** The push for a reply, or null when there is nothing worth saying. */
export function replyPush(conversation: AssistantConversation, reply: AssistantMessage, prefs: AssistantNotifyPrefs): PushPayload | null {
  const first = reply.proposal?.state === "pending" ? reply.proposal.items[0] : null;
  const title = first ? "Rooftap needs your OK" : `Rooftap answered: ${conversationTitle(conversation)}`;
  const body = !prefs.preview ? "Tap to read it." : first ? first.summary : replyPreview(reply.content) || "Tap to read it.";
  return { title, body, url: `/assistant/${conversation.id}`, tag: `assistant-${conversation.id}` };
}

export interface NotifyDeps extends PushDeps {
  sleep?: (ms: number) => Promise<void>;
}

/**
 * After the grace, push the reply to its asker unless the app showed it.
 * Runs after the response is sent (next/server `after`).
 */
export async function notifyIfAway(
  who: Who,
  conversation: AssistantConversation,
  reply: AssistantMessage,
  deps: NotifyDeps = {}
): Promise<"sent" | "noticed" | "off" | "none"> {
  await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(NOTIFY_GRACE_MS);
  const [states, prefs] = await Promise.all([readStates(who, [conversation.id]), loadNotifyPrefs(who.admin, who.userId)]);
  const state = states.get(conversation.id);
  const answeredAt = Date.parse(reply.created_at);
  const noticed = [state?.read_at, state?.seen_at].some((t) => t && Date.parse(t) >= answeredAt);
  if (noticed) return "noticed";
  if (!prefs.replies) return "off";
  const payload = replyPush(conversation, reply, prefs);
  if (!payload) return "none";
  const { sent } = await sendPushToUsers(who.admin, [who.userId], payload, deps);
  return sent > 0 ? "sent" : "none";
}

/**
 * A member wrote in the household thread: after the grace, push it to the
 * other members who haven't read it (or seen it in the app) and haven't
 * switched assistant notifications off. Tagged messages go out the same way,
 * since the ask and Rooftap's answer are news to everyone.
 */
export async function notifyHousehold(
  who: Who,
  conversation: AssistantConversation,
  message: AssistantMessage,
  deps: NotifyDeps = {}
): Promise<number> {
  await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(NOTIFY_GRACE_MS);
  const { data: members } = await who.admin.from("group_members").select("user_id").eq("group_id", who.groupId);
  const others = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id).filter((id) => id !== who.userId);
  if (others.length === 0) return 0;
  const [{ data: reads }, { data: prefRows }] = await Promise.all([
    who.admin.from("assistant_reads").select("user_id, read_at, seen_at").eq("conversation_id", conversation.id).in("user_id", others),
    who.admin.from("assistant_notify_prefs").select("user_id, replies, preview").in("user_id", others),
  ]);
  const sentAt = Date.parse(message.created_at);
  const noticed = new Set(
    ((reads ?? []) as (ReadState & { user_id: string })[])
      .filter((r) => [r.read_at, r.seen_at].some((t) => t && Date.parse(t) >= sentAt))
      .map((r) => r.user_id)
  );
  const prefs = new Map(((prefRows ?? []) as (AssistantNotifyPrefs & { user_id: string })[]).map((p) => [p.user_id, p]));
  const due = others.filter((id) => !noticed.has(id) && prefs.get(id)?.replies !== false);
  if (due.length === 0) return 0;
  const title = `${message.author ?? "Someone"} in Household`;
  const payload = (preview: boolean): PushPayload => ({
    title,
    body: preview ? replyPreview(message.content) || "Tap to read it." : "Tap to read it.",
    url: `/assistant/${conversation.id}`,
    tag: `assistant-${conversation.id}`,
  });
  const withPreview = due.filter((id) => prefs.get(id)?.preview !== false);
  const without = due.filter((id) => prefs.get(id)?.preview === false);
  const results = await Promise.all([
    withPreview.length ? sendPushToUsers(who.admin, withPreview, payload(true), deps) : { sent: 0 },
    without.length ? sendPushToUsers(who.admin, without, payload(false), deps) : { sent: 0 },
  ]);
  return results.reduce((n, r) => n + r.sent, 0);
}
