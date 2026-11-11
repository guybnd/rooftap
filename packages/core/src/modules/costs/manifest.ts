import { defineModule, REACH_REASONS } from '../../module-manifest';
import { upBankConnector } from './connectors/up-bank';
import { csvBankConnector } from './connectors/csv-bank';

export const costsModule = defineModule({
  id: 'costs',
  label: 'Costs & Budget',
  description: 'Bills, recurring costs and a monthly budget.',
  feeds: 'Bills due show on Home and the Calendar',
  startingSets: ['moving', 'everything'],
  askStarters: [
    { text: "Which subscriptions could we cancel?", with: [], needsData: true },
    { text: "Why was last month higher than usual?", with: [], needsData: true },
  ],
  iconId: 'wallet',
  defaultEnabled: true,
  enhances: ['setup', 'groceries', 'search'],
  section: {
    label: 'Costs & Budget',
    shortLabel: 'Costs',
    basePath: '/costs',
    acceptsShares: false,
    navItems: [
      { href: '/costs', label: 'Overview', iconId: 'wallet', accent: true },
    ],
    hue: 'sun',
  },
  tables: {
    cost_items: { reach: { tools: ['get_budget_summary', 'create_cost_item', 'update_cost_item', 'delete_cost_item', 'get_agenda', 'get_money_insights'] }, sync: ['costs'] },
    cost_item_comments: { reach: { none: REACH_REASONS.comments } },
    up_bank_connections: { reach: { none: REACH_REASONS.account } },
    bank_accounts: { reach: { tools: ['get_bank_spending'] } },
    bank_transactions: { reach: { tools: ['get_bank_spending', 'update_bank_payment', 'make_cost_from_payment'] } },
    bank_feed_settings: { reach: { none: "A person's own choice of what bank data the household sees, kept out of the Assistant on purpose." } },
    bank_links: { reach: { tools: ['set_bank_link_rule', 'merge_cost_lines', 'update_bank_payment'] } },
  },
  tools: [
    { name: 'get_budget_summary', kind: 'read' },
    { name: 'create_cost_item', kind: 'write' },
    { name: 'update_cost_item', kind: 'write' },
    { name: 'delete_cost_item', kind: 'write' },
    { name: 'get_bank_spending', kind: 'read' },
    { name: 'update_bank_payment', kind: 'write' },
    { name: 'make_cost_from_payment', kind: 'write' },
    { name: 'set_bank_link_rule', kind: 'write' },
    { name: 'merge_cost_lines', kind: 'write' },
  ],
  connectors: [upBankConnector, csvBankConnector],
  settings: ['costs-goal', 'costs-recent', 'costs-subscriptions', 'costs-summaries'],
  spaces: [
    { key: 'budget', label: 'Budget', size: 'card', lens: 'budgetPulse', setting: 'spaceBudget' },
    { key: 'bills', label: 'Bills', size: 'card', lens: 'billsDue', setting: 'spaceBills' },
  ],
  slots: ['search'],
  helper: {
    label: 'Money helper',
    subtitle: 'Bills, budget and spending',
    focus:
      "You look after this household's money: the bills and regular costs, the month against its budget, and what the bank says was spent. " +
      'Work like this. For the month, read get_budget_summary; for where money went, get_money_insights and get_bank_spending (when a bank is linked). ' +
      'Answer with numbers the person can act on: what is due and when, how the month is tracking against the goal, which category is over its usual and by how much. ' +
      'When your answer lists cost lines, show them as rows with show_items (module costs, the brief gives this week\'s ids) and keep the words to the one or two things that matter. ' +
      'The person already sees the brief, so never send them back to it: bring something new, such as a deal ending that is worth switching, a cost that went up, or a bill with no date. ' +
      'Change a cost line only when the person asks, one tool call per line, and confirm in one short line. ' +
      'Never guess an amount or a date: look it up, or say what is missing. Lines another member keeps private are hidden from you.',
    reads: ['money-insights'],
    summary: {
      label: 'Catch me up',
      ask: 'Catch me up on money: what is due this week and this month, how the month is tracking against the budget, anything that changed or looks off, and the one thing I should do first.',
    },
    starters: ['Where did most of our money go this month?', 'Which bills could we cut or switch?', 'Are we on track for the month?'],
  },
});
