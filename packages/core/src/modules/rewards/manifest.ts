import { defineModule } from '../../module-manifest';

export const rewardsModule = defineModule({
  id: 'rewards',
  label: 'Rewards',
  description: 'Loyalty cards and memberships, the stores they work at, and what they get you there.',
  iconId: 'wallet-cards',
  defaultEnabled: false,
  enhances: ['groceries'],
  minSchema: '20261021130000_rewards',
  section: {
    label: 'Rewards',
    shortLabel: 'Rewards',
    basePath: '/rewards',
    acceptsShares: false,
    navItems: [
      { href: '/rewards', label: 'Cards', iconId: 'wallet-cards', accent: true },
    ],
    hue: 'fern',
  },
  slots: ['search'],
  tables: {
    // Cards live in Groceries' sheet and in Rewards.
    loyalty_cards: { reach: { tools: ['get_rewards'] }, sync: ['groceries', 'rewards'] },
    reward_schemes: { reach: { tools: ['get_rewards', 'add_reward_perk'] }, sync: ['rewards'] },
    reward_partners: { reach: { tools: ['get_rewards'] }, sync: ['rewards'] },
    reward_perks: { reach: { tools: ['get_rewards', 'add_reward_perk'] }, sync: ['rewards'] },
  },
  tools: [
    { name: 'get_rewards', kind: 'read' },
    { name: 'add_reward_perk', kind: 'write' },
  ],
});
