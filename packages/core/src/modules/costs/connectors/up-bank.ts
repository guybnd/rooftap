import { defineConnector } from '../../../connector';

// Up Bank (.docs/connectors.md): each person connects their own Up account
// with a personal access token. The server reads Up when someone opens Costs,
// and Up pushes new payments to /api/up-bank/webhook/<hook_id> when it can
// reach the server. Up allows its API for personal use only, so on the hosted
// server only the operator's household may connect. The server side is
// apps/web/src/lib/up-bank.ts, the shapes are in ../up-bank.ts.
export const upBankConnector = defineConnector({
  id: 'up-bank',
  label: 'Up Bank',
  description: 'Reads your Up payments and balances. Rooftap never moves money.',
  iconId: 'landmark',
  kinds: ['pull', 'webhook'],
  data: 'bank-transactions',
  source: 'up',
  keys: [{ id: 'up-token', from: 'person', label: 'Up personal access token, from api.up.com.au' }],
  hosted: 'operator',
  regions: ['AU'],
  serverFeature: 'connectors.up-bank',
  panel: 'up-bank',
  homepage: 'https://developer.up.com.au',
});
