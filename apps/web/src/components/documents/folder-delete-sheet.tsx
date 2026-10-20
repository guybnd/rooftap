'use client';

// Deleting a folder (Hearth M4): what happens to the documents inside is an
// explicit choice. Left off, they go back to All documents; switched on, they
// are deleted with the folder, and that path asks once more before anything
// goes. Same finish as FolderMoveSheet. Mobile twin: FolderDeleteSheet in
// apps/mobile/src/components/documents/folder-ui.tsx.

import { useEffect, useState } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export function FolderDeleteSheet({
  open,
  onOpenChange,
  folderName,
  documentCount,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderName: string;
  /** Documents in the folder and every folder under it. */
  documentCount: number;
  onDelete: (withDocuments: boolean) => void;
}) {
  const [withDocuments, setWithDocuments] = useState(false);

  // Each opening starts with the documents kept.
  useEffect(() => {
    if (open) setWithDocuments(false);
  }, [open]);

  const documentsLabel = documentCount === 1 ? '1 document' : `${documentCount} documents`;
  const deletesDocuments = withDocuments && documentCount > 0;

  const submit = () => {
    // A centre dialog is correct here per Hearth M4: destructive confirm.
    if (
      deletesDocuments &&
      !window.confirm(
        `Delete ${folderName} and ${documentsLabel}? The documents are deleted for everyone in the household. This can’t be undone.`
      )
    ) {
      return;
    }
    onOpenChange(false);
    onDelete(deletesDocuments);
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      overlayClassName="bg-black/40"
      className={cn(
        'rounded-t-2xl border-t border-border bg-popover/95 text-popover-foreground shadow-2xl shadow-black/50 backdrop-blur-xl',
        'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border'
      )}
      handleClassName="sm:hidden"
    >
      <div className="space-y-3 px-4 pb-2 pt-1 sm:pt-4">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Delete folder</p>
          <p className="truncate text-sm text-foreground">{folderName}</p>
        </div>
        {documentCount > 0 ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-foreground">Delete its {documentsLabel} too</span>
              <span className="block text-xs text-muted-foreground">
                {withDocuments ? 'They are deleted along with the folder.' : 'Left off, they move back to All documents.'}
              </span>
            </span>
            <Switch checked={withDocuments} onChange={setWithDocuments} label={`Delete its ${documentsLabel} too`} />
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">This folder has no documents in it.</p>
        )}
        {/* E4: destructive is danger text, never a fill. */}
        <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={submit}>
          {deletesDocuments ? `Delete folder and ${documentsLabel}` : 'Delete folder'}
        </Button>
      </div>
    </BottomSheet>
  );
}
