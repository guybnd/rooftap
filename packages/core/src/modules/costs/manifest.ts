import { defineModule, REACH_REASONS } from '../../module-manifest';
import { upBankConnector } from './connectors/up-bank';

export const costsModule = defineModule({
  id: 'costs',
  label: 'Costs & Budget',
  description: 'Bills, recurring costs and a monthly budget.',
  iconId: 'wallet',
  defaultEnabled: false,
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
  connectors: [upBankConnector],
  settings: ['costs-goal', 'costs-recent', 'costs-subscriptions', 'costs-summaries'],
});
