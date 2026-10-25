'use client';

// The Documents explorer's preview pane (wide web): the picked file drawn
// small, its main actions, its expiry and reminder, and its details. Open
// shows it full size in the preview popup; a self-hosted editor can take
// that button over later. The phone shows the same facts in its file sheet
// (apps/mobile/src/components/documents/file-sheet.tsx), from the same core
// helpers.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { signedDocumentUrl, SIGNED_URL_TTL_SECONDS, type UnifiedDocument } from '@/lib/documents';
import { documentDetailRows, documentExpiryNote, serviceLabel, type CostItem, type DocumentFolder, type DocumentLink } from '@homeup/core';
import { memberLabel } from '@/app/setup/member-label';
import { DOC_TYPE_GLYPH, SOURCE_LABEL } from '@/app/documents/document-card';
import { PortalChipRow, type PortalChipDef } from '@/components/ui/portal-chip';
import { Button } from '@/components/ui/button';
import { DocumentPreview } from './document-preview';
import { DocumentEditModal } from './document-edit-modal';
import { useDocumentActions } from './use-document-actions';
import { BellRing, CalendarClock, Download, ExternalLink, FileText, FolderInput, Loader2, Pencil, Share2, X } from 'lucide-react';

const NOTE_TONE = { expired: 'text-destructive', soon: 'text-warning', later: 'text-muted-foreground' };

export function DocumentInspector({
  doc,
  docLinks,
  costItems,
  costNames,
  folders,
  memberProfiles,
  reminderTaskId,
  onOpenReminder,
  onOpenLink,
  onToggleTag,
  onMoveToFolder,
  onChanged,
  onClose,
}: {
  doc: UnifiedDocument;
  docLinks: DocumentLink[];
  costItems: CostItem[];
  costNames: Record<string, string>;
  folders: DocumentFolder[];
  memberProfiles: Record<string, { email: string; name: string | null; avatar: string | null }>;
  reminderTaskId: string | null;
  onOpenReminder: ((taskId: string) => void) | null;
  onOpenLink: (link: Pick<DocumentLink, 'entity_type' | 'entity_id'>) => void;
  onToggleTag: (tag: string) => void;
  /** Called with the store id, after adopting a legacy file if it needed one. */
  onMoveToFolder: (storeId: string) => void;
  onChanged: () => Promise<void> | void;
  onClose: () => void;
}) {
  const { busy, storeId, ensureStored, share, download, createReminder } = useDocumentActions(doc, onChanged);
  const [previewing, setPreviewing] = useState(false);
  const [editing, setEditing] = useState(false);

  // A signed link for the small preview, fetched again for each file.
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    void signedDocumentUrl(createClient(), doc.storagePath, SIGNED_URL_TTL_SECONDS, doc.bucket).then((signed) => {
      if (cancelled) return;
      if (signed) setUrl(signed);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [doc.storagePath, doc.bucket]);

  const isImage = /\.(jpe?g|png|webp|gif)$/i.test(doc.filename);
  const isPdf = /\.pdf$/i.test(doc.filename);
  const TypeGlyph = DOC_TYPE_GLYPH[doc.docType] ?? FileText;
  const name = doc.title || doc.filename;
  const note = documentExpiryNote(doc);
  const origin = doc.impliedEntity
    ? serviceLabel(doc.impliedEntity.type, doc.impliedEntity.id, costNames)
    : doc.source !== 'capture' && doc.source !== 'other'
      ? SOURCE_LABEL[doc.source]
      : null;
  const details = documentDetailRows(doc, {
    folders,
    addedBy: doc.uploadedBy ? memberLabel(doc.uploadedBy, memberProfiles) : null,
    origin,
  });
  // Tags filter the list in place; cost and other links leave the section (Hearth PC).
  const chips: PortalChipDef[] = [
    ...doc.tags.map((t) => ({ key: `tag-${t}`, label: `#${t}`, tone: 'neutral' as const, onOpen: () => onToggleTag(t) })),
    ...docLinks.map((link) => ({
      key: `link-${link.id}`,
      label: serviceLabel(link.entity_type, link.entity_id, costNames),
      tone: 'accent' as const,
      onOpen: () => onOpenLink(link),
    })),
  ];

  return (
    <aside aria-label="Preview" className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-base font-semibold leading-snug text-foreground">{name}</h2>
          {doc.title && <p className="truncate text-xs text-muted-foreground">{doc.filename}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="-mr-1.5 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* The file itself, small. A click opens it full size. */}
      <button
        type="button"
        onClick={() => setPreviewing(true)}
        aria-label={`Open ${name}`}
        className="relative flex h-64 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-muted/60 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {failed ? (
          <TypeGlyph className="h-10 w-10 text-muted-foreground" />
        ) : !url ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : isPdf ? (
          // The PDF's first page, read only: clicks go to the button over it.
          <iframe src={`${url}#toolbar=0&navpanes=0&view=FitH`} title={name} tabIndex={-1} className="pointer-events-none h-full w-full bg-white" />
        ) : (
          <TypeGlyph className="h-10 w-10 text-muted-foreground" />
        )}
      </button>

      <div className="flex items-center gap-2">
        <Button className="h-9 flex-1" onClick={() => setPreviewing(true)}>
          <ExternalLink className="h-4 w-4" />
          Open
        </Button>
        <Button
          variant="outline"
          className="h-9"
          disabled={busy}
          onClick={() => void ensureStored().then((id) => id && setEditing(true))}
        >
          <Pencil className="h-4 w-4" />
          Edit
        </Button>
        <Button variant="outline" size="icon-lg" aria-label="Download" title="Download" onClick={() => void download()}>
          <Download className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon-lg" aria-label="Share" title="Share" onClick={() => void share()}>
          <Share2 className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Move to folder"
          title="Move to folder"
          disabled={busy}
          onClick={() => void ensureStored().then((id) => id && onMoveToFolder(id))}
        >
          <FolderInput className="h-4 w-4" />
        </Button>
      </div>

      {/* Expiry and its reminder, the reason most files are kept. */}
      {(note || reminderTaskId) && (
        <div className="flex items-center gap-3 rounded-2xl bg-muted/60 px-3.5 py-3">
          <BellRing className={cn('h-4 w-4 shrink-0', note ? NOTE_TONE[note.tone] : 'text-muted-foreground')} />
          <div className="min-w-0 flex-1">
            {note && <p className={cn('text-sm font-medium', note.tone === 'later' ? 'text-foreground' : NOTE_TONE[note.tone])}>{note.text}</p>}
            <p className="text-xs text-muted-foreground">{reminderTaskId ? 'Reminder set' : 'No reminder yet'}</p>
          </div>
          {reminderTaskId ? (
            onOpenReminder && (
              <Button variant="ghost" size="sm" onClick={() => onOpenReminder(reminderTaskId)}>
                Open reminder
              </Button>
            )
          ) : (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void createReminder()}>
              <CalendarClock className="h-3.5 w-3.5" />
              Set reminder
            </Button>
          )}
        </div>
      )}

      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        {details.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>

      {chips.length > 0 && <PortalChipRow chips={chips} />}

      {previewing && (
        <DocumentPreview
          filename={doc.filename}
          storagePath={doc.storagePath}
          bucket={doc.bucket}
          label={doc.title}
          onClose={() => setPreviewing(false)}
        />
      )}
      {editing && storeId && (
        <DocumentEditModal
          doc={{ ...doc, storeId, legacy: false }}
          docLinks={docLinks}
          costItems={costItems}
          onClose={() => setEditing(false)}
          onSaved={onChanged}
        />
      )}
    </aside>
  );
}
