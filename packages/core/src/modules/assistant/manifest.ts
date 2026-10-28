import { defineModule, REACH_REASONS } from '../../module-manifest';

export const assistantModule = defineModule({
  id: 'assistant',
  label: 'Assistant',
  description: 'A household agent you can ask or talk to, with your OK before it changes anything.',
  iconId: 'sparkles',
  defaultEnabled: false,
  enhances: ['household', 'calendar', 'costs', 'groceries'],
  minSchema: '20261021020000_assistant',
  section: {
    label: 'Assistant',
    shortLabel: 'Assistant',
    basePath: '/assistant',
    acceptsShares: false,
    navItems: [
      { href: '/assistant', label: 'Chats', iconId: 'sparkles', accent: true },
    ],
    hue: 'indigo',
  },
  tables: {
    assistant_conversations: { reach: { none: 'The chats themselves.' } },
    assistant_home_assistant: { reach: { none: REACH_REASONS.account } },
    assistant_member_limits: { reach: { none: 'Owner limits on what each member may ask; they shape the tools offered.' } },
    assistant_memories: { reach: { none: 'Remembered facts go in the prompt, written with the remember marker.' } },
    assistant_messages: { reach: { none: 'The chats themselves.' } },
    assistant_notify_prefs: { reach: { none: 'Each person\'s notification choice, in Settings.' } },
    assistant_reads: { reach: { none: REACH_REASONS.server } },
    assistant_settings: { reach: { none: 'The Assistant\'s own settings, kept with owners in Settings.' } },
    assistant_telegram_codes: { reach: { none: REACH_REASONS.account } },
    assistant_telegram_links: { reach: { none: REACH_REASONS.account } },
    assistant_telegram_updates: { reach: { none: REACH_REASONS.server } },
    assistant_usage: { reach: { none: REACH_REASONS.server } },
    assistant_web_lookups: { reach: { none: REACH_REASONS.server } },
  },
  noTools: 'The Assistant itself. Its settings stay in Settings, where an owner decides what it may do.',
  settings: ['assistant', 'assistant-spending', 'assistant-telegram', 'assistant-home-assistant'],
  spaces: [{ key: 'assistant', label: 'Assistant', size: 'tile' }],
});
