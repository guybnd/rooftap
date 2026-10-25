'use client';

// What a document row and the explorer's preview pane can both do to one
// file: adopt a legacy file into the store the first time an action needs a
// store row, share it, and set its expiry reminder.

import { useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { adoptLegacyDocument, signedDocumentUrl, SIGNED_URL_TTL_SECONDS, type UnifiedDocument } from '@/lib/documents';
import { createManualReminder, documents$, reminderKey, syncDocumentReminder, useStoreHelpers } from '@homeup/core';

export function useDocumentActions(doc: UnifiedDocument, onChanged: () => Promise<void> | void) {
  const [busy, setBusy] = useState(false);

  // Legacy files (bill attachments, grocery receipts) have no store row to
  // edit, file or remind on. The first such action adopts the file into the
  // store, which the old Adopt button did as a separate step, and seeds the
  // store with the new row so the action lands on it at once.
  const { seedRow } = useStoreHelpers(documents$(doc.groupId), null);
  const [adoptedId, setAdoptedId] = useState<string | null>(null);
  const storeId = doc.storeId ?? adoptedId;
  const ensureStored = async (): Promise<string | null> => {
    if (storeId) return storeId;
    setBusy(true);
    try {
      const row = await adoptLegacyDocument(createClient(), doc);
      seedRow(row);
      setAdoptedId(row.id);
      return row.id;
    } catch (e) {
      console.error('Adopting a legacy file failed:', e);
      toast.error("Couldn't open that file for editing");
      return null;
    } finally {
      setBusy(false);
    }
  };

  // FLUX-234: Web Share API when available (with the file itself, so the OS
  // share sheet can hand it to another app), falling back to sharing just the
  // signed link, then to opening it in a new tab if navigator.share is absent.
  const share = async () => {
    const url = await signedDocumentUrl(createClient(), doc.storagePath, SIGNED_URL_TTL_SECONDS, doc.bucket);
    if (!url) return;
    const label = doc.title || doc.filename;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], doc.filename, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: label });
        return;
      }
    } catch (err) {
      // A deliberate cancel of the file-share sheet should not re-pop a second
      // (link-based) share sheet — only genuine failures fall through below.
      if (err instanceof Error && err.name === 'AbortError') return;
    }
    if (navigator.share) {
      try {
        await navigator.share({ url, title: label });
        return;
      } catch {
        // user cancelled or share failed — fall back to opening the file
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Saves the file under its own name, from a signed link.
  const download = async () => {
    const url = await signedDocumentUrl(createClient(), doc.storagePath, SIGNED_URL_TTL_SECONDS, doc.bucket);
    if (!url) {
      toast.error("Couldn't download that file");
      return;
    }
    try {
      const blob = await (await fetch(url)).blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = doc.filename;
      a.click();
      URL.revokeObjectURL(href);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const createReminder = async () => {
    const id = await ensureStored();
    if (!id) return;
    const supabase = createClient();
    const name = doc.title || doc.filename;
    if (doc.expiryDate) {
      await syncDocumentReminder(supabase, { id, groupId: doc.groupId, name, expiryDate: doc.expiryDate });
    } else {
      await createManualReminder(supabase, {
        groupId: doc.groupId, templateKey: reminderKey('document', id, 'expiry'), title: `Renew ${name}`,
      });
    }
    await onChanged();
  };

  return { busy, storeId, ensureStored, share, download, createReminder };
}
