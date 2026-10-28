import { defineModule } from '../../module-manifest';

export const moneyInsightsModule = defineModule({
  id: 'money-insights',
  label: 'Money insights',
  description: 'Price rises, subscriptions to rethink and ways to save, on the Costs page.',
  iconId: 'lightbulb',
  // Lives on the Costs page, so it needs no switch of its own to lock
  // Costs on: with Costs off there is nowhere to show it.
  defaultEnabled: true,
  enhances: ['costs', 'shopper', 'household'],
  tools: [
    { name: 'get_money_insights', kind: 'read' },
  ],
});
