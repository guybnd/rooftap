// Rooftap Assistant: a reply that lands after you left its chat. With the app
// in front it shows as a "Rooftap answered" toast with Open and tells the
// server it was seen, so no push follows; in the background it does nothing
// and the push covers it. Also keeps the + dot's unread count fresh (on
// launch and whenever the app comes back). Web twin:
// apps/web/src/components/assistant-answers.tsx.
import * as React from 'react';
import { AppState } from 'react-native';
import { conversationTitle, onAnswerElsewhere, openAssistantPopup, replyPreview, useModules } from '@homeup/core';
import { toast } from '@homeup/ui';
import { useDataCache } from '@/lib/data-cache';
import { useOpenRoute } from '@/lib/tab-routes';
import { assistantApi, refreshAssistantUnread } from './assistant-api';

export function AssistantAnswers() {
  const modules = useModules();
  const { group, isOnline } = useDataCache();
  const openRoute = useOpenRoute();
  const openRouteRef = React.useRef(openRoute);
  React.useEffect(() => {
    openRouteRef.current = openRoute;
  }, [openRoute]);
  const on = modules.isEnabled('assistant') && modules.server('assistant.reply-notifications') && !!group?.id && isOnline;

  React.useEffect(() => {
    if (!on) return;
    void refreshAssistantUnread();
    const sub = AppState.addEventListener('change', (state) => state === 'active' && void refreshAssistantUnread());
    const stop = onAnswerElsewhere(({ conversation, reply }) => {
      if (AppState.currentState !== 'active') return;
      void assistantApi.markRead(conversation.id, { seen: true }).catch(() => {});
      toast.message('Rooftap answered', {
        description: replyPreview(reply.content, 90) || conversationTitle(conversation),
        duration: 8000,
        placement: 'top',
        action: {
          label: 'Open',
          onPress: () => openAssistantPopup({ conversationId: conversation.id }) || openRouteRef.current(`/assistant/${conversation.id}`),
        },
      });
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [on]);

  return null;
}
