// HOUP-443: what the Assistant shows instead of a chat when it can't run:
// hosted without Plus (the full upgrade sheet is HOUP-445), no model set up on
// the server, or this month's budget used up.
// Web twin: apps/web/src/app/assistant/assistant-notice.tsx.
import type { AssistantErrorCode } from '@homeup/core';
import { Sparkles } from 'lucide-react-native';
import { EmptyState } from '@homeup/ui';

const COPY: Record<AssistantErrorCode, { title: string; description: string }> = {
  assistant_requires_plus: {
    title: 'The assistant comes with Plus',
    description: 'Rooftap Plus includes the assistant, with a monthly allowance. Self-hosted servers always include it.',
  },
  assistant_not_configured: {
    title: 'No AI model set up yet',
    description:
      'Whoever runs this server can add a model key (Gemini, OpenRouter, OpenAI, Anthropic) or point it at a local model. See the self-hosting guide.',
  },
  assistant_budget_reached: {
    title: "This month's assistant budget is used up",
    description: 'An owner can raise the budget in Settings > Assistant, or it starts again next month.',
  },
  assistant_conversation_closed: {
    title: 'This quick ask has closed',
    description: 'Start a new one from the Assistant.',
  },
};

export function AssistantNotice({ code }: { code: AssistantErrorCode }) {
  const copy = COPY[code];
  return <EmptyState icon={Sparkles} title={copy.title} description={copy.description} />;
}
