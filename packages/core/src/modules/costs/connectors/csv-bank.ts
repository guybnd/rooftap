import { defineConnector } from '../../../connector';

// Bank statement import (.docs/connectors.md): a person exports a CSV from
// their bank's website and picks it in Settings > Connectors. The app reads
// it on the device (../bank-csv.ts) and the server saves the payments
// through the shared bank feed path (apps/web/src/app/api/bank-import).
// Any bank, any country, and no account details leave the person's hands.
export const csvBankConnector = defineConnector({
  id: 'csv-bank',
  label: 'Bank statement',
  description: 'Import a CSV statement from any bank. Import a newer one any time, and payments already there are skipped.',
  iconId: 'file-text',
  kinds: ['import'],
  data: 'bank-transactions',
  source: 'csv',
  hosted: 'everyone',
  regions: ['*'],
  serverFeature: 'connectors.bank-import',
  panel: 'bank-import',
});
