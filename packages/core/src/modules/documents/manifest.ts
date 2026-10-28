import { defineModule } from '../../module-manifest';

export const documentsModule = defineModule({
  id: 'documents',
  label: 'Documents',
  description: 'Warranties, receipts and paperwork, filed in folders.',
  iconId: 'folder-open',
  defaultEnabled: true,
  enhances: ['costs', 'setup', 'groceries'],
  section: {
    label: 'Documents',
    shortLabel: 'Docs',
    basePath: '/documents',
    acceptsShares: false,
    navItems: [
      { href: '/documents', label: 'All Documents', iconId: 'folder-open', accent: true },
    ],
    hue: 'slate',
  },
  tables: {
    documents: { reach: { tools: ['find_documents'] }, sync: ['documents'] },
    document_folders: { reach: { tools: ['find_documents'] } },
    document_links: { reach: { none: 'Links between a document and a cost, purchase or event; the linked item is reached through its own module.' } },
    cost_documents: { reach: { none: 'Receipt files from before Documents; new receipts are documents.' } },
  },
  tools: [
    { name: 'find_documents', kind: 'read' },
  ],
});
