"use client";

// Rooftap Assistant: a reply that lands after you left its chat. In view, it
// shows as a "Rooftap answered" toast with Open and tells the server it was
// seen, so no push follows; in a hidden tab it does nothing and the push
// covers it. Also keeps the + dot's unread count fresh (on load and when the
// tab comes back). Native twin: apps/mobile/src/features/assistant/assistant-answers.tsx.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { conversationTitle, onAnswerElsewhere, openAssistantPopup, replyPreview, useModules } from "@homeup/core";
import { useDataCache } from "@/lib/data-cache";
import { assistantApi, refreshAssistantUnread } from "@/lib/assistant-client";

export function AssistantAnswers() {
  const router = useRouter();
  const modules = useModules();
  const { group, isOnline } = useDataCache();
  const on = modules.isEnabled("assistant") && modules.server("assistant.reply-notifications") && !!group?.id && isOnline;

  useEffect(() => {
    if (!on) return;
    void refreshAssistantUnread();
    const onVisible = () => document.visibilityState === "visible" && void refreshAssistantUnread();
    document.addEventListener("visibilitychange", onVisible);
    const stop = onAnswerElsewhere(({ conversation, reply }) => {
      if (document.visibilityState !== "visible") return;
      void assistantApi.markRead(conversation.id, { seen: true }).catch(() => {});
      const href = `/assistant/${conversation.id}`;
      toast("Rooftap answered", {
        description: replyPreview(reply.content, 90) || conversationTitle(conversation),
        duration: 8000,
        action: { label: "Open", onClick: () => openAssistantPopup({ conversationId: conversation.id }) || router.push(href) },
      });
    });
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [on, router]);

  return null;
}
