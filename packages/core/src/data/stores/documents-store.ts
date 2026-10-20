'use client';

// FLUX-150 slice 7 / HOUP-83: documents local-first store. Backs only the
// native `documents`-table rows — listUnifiedDocuments() in ../../documents.ts
// merges these with the legacy cost_documents/grocery-receipt silos, which
// stay on their existing Supabase-direct read (see documents.ts for the
// merge). Mirrors recipes-store.ts.

import { createGroupStore } from '../create-group-store';
import type { Document } from '../../types';

export const documents$ = createGroupStore<Document>({
  collection: 'documents',
  storageName: 'documents',
});
