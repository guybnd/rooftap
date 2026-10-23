'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { adoptLegacyDocument, signedDocumentUrl, docTypeLabel, SIGNED_URL_TTL_SECONDS, type UnifiedDocument } from '@/lib/documents';
import { PopMenu, MenuItem, MenuDivider } from '@/app/setup/pop-menu';
import { useRowContextMenu, withRowMenu } from '@/components/ui/row-context-menu';
import { reminderKey, createManualReminder, syncDocumentReminder, documentMetadataValue, documentExpiryLabel, expiryDaysOf } from '@homeup/core';
import { dialog } from '@homeup/core';
import { memberLabel } from '@/app/setup/member-label';
import { rowMotionClass, type RowMotion } from '@/components/documents/folder-browser';
import { stopRow, useRowLongPress } from '@/components/documents/use-row-long-press';
import { metadataSummary, documents$, useStoreHelpers, serviceLabel } from '@homeup/core';
import { timeAgo } from '@homeup/core';
import { toast } from 'sonner';
import { ListItem, ListItemLeading, ListItemContent, ListItemTitle, ListItemMeta, ListItemTrailing } from '@/components/ui/list-item';
import { PortalChipRow, type PortalChipDef } from '@/components/ui/portal-chip';
import { DocumentPreview } from '@/components/documents/document-preview';
import { DocumentEditModal } from '@/components/documents/document-edit-modal';
import type { DocumentLink, DocumentSource, CostItem } from '@homeup/core';
import { BookOpen, CalendarClock, CalendarPlus, Car, Check, Eye, FileText, FolderInput, HeartPulse, IdCard, Image as ImageIcon, Key, Landmark, ListChecks, MoreHorizontal, Pencil, Receipt, Share2, Shield, ShieldCheck, Signature, Trash2, Wrench, type LucideIcon } from 'lucide-react';

// Only expired and soon take a status hue, as a word (H2).
const EXPIRY_TONE_CLASS = { expired: 'text-destructive', soon: 'text-warning', later: undefined };

export const SOURCE_LABEL: Record<DocumentSource, string> = {
  capture: 'Capture', cost: 'Costs', warranty: 'Warranties', grocery: 'Groceries', other: 'Other',
};

// Hearth §6 Document row: the leading chip is the doc type, a glyph on a
// neutral inset tile. Type is identity, not state, so it takes no hue (H2).
// Same glyphs as mobile's document-row.tsx.
export const DOC_TYPE_GLYPH: Record<string, LucideIcon> = {
  invoice: FileText,
  receipt: Receipt,
  warranty: ShieldCheck,
  manual: BookOpen,
  contract: Signature,
  photo: ImageIcon,
  id_personal: IdCard,
  insurance: Shield,
  lease_contract: Key,
  tax_financial: Landmark,
  medical: HeartPulse,
  vehicle: Car,
  appliance_manual: Wrench,
  bill: Receipt,
  other: FileText,
};

export function DocumentCard({
  doc, docLinks, costItems, costNames, memberProfiles, reminderTaskId, onOpenReminder, onOpenLink, onToggleTag, onMoveToFolder, onAddToCalendar, onChanged, onDelete, motion,
  onSelect, selecting, selected, onToggleSelect,
}: {
  doc: UnifiedDocument;
  docLinks: DocumentLink[];
  costItems: CostItem[];
  costNames: Record<string, string>;
  memberProfiles: Record<string, { email: string; name: string | null; avatar: string | null }>;
  reminderTaskId: string | null;
  /** Null when the reminder's task can't be opened (Tasks off). */
  onOpenReminder: ((taskId: string) => void) | null;
  onOpenLink: (link: Pick<DocumentLink, 'entity_type' | 'entity_id'>) => void;
  onToggleTag: (tag: string) => void;
  /** Called with the store id, after adopting a legacy file if it needed one. */
  onMoveToFolder: (storeId: string) => void;
  /** Documents' "Add to calendar" (calendar.event-documents); undefined hides it. Called with the store id. */
  onAddToCalendar?: (storeId: string) => void;
  onChanged: () => Promise<void> | void;
  /** Takes the document off the list now and deletes it behind that. */
  onDelete: () => void;
  motion: RowMotion;
  /** Starts select mode with this document ticked. */
  onSelect: () => void;
  /** Select mode: a tap or a hold ticks the row instead of opening it. */
  selecting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [holdMenuOpen, setHoldMenuOpen] = useState(false);

  const longPress = useRowLongPress(() => (selecting ? onToggleSelect() : setHoldMenuOpen(true)));
  // Hearth §13.7 "Row menu": right-click with a mouse (outside select mode).
  const rowMenu = useRowContextMenu(() =>
    selecting
      ? null
      : {
          title: doc.title || doc.filename,
          kind: 'Document',
          actions: [
            { id: 'preview', label: 'Preview', group: 'open', icon: 'open', run: () => setPreviewing(true) },
            !!reminderTaskId && !!onOpenReminder && { id: 'reminder', label: 'Open reminder', group: 'open', icon: 'due', run: () => onOpenReminder(reminderTaskId) },
            !reminderTaskId && { id: 'remind', label: 'Set reminder', group: 'set', icon: 'due', run: () => void createReminder() },
            { id: 'move', label: 'Move to folder', group: 'set', icon: 'move', run: () => void ensureStored().then((id) => id && onMoveToFolder(id)) },
            !!onAddToCalendar && { id: 'calendar', label: 'Add to calendar', group: 'set', icon: 'calendar', run: () => void ensureStored().then((id) => id && onAddToCalendar(id)) },
            { id: 'share', label: 'Share', group: 'share', icon: 'share', run: () => void share() },
            { id: 'select', label: 'Select', group: 'edit', icon: 'select', run: onSelect },
            { id: 'edit', label: 'Edit details', group: 'edit', icon: 'edit', run: () => void ensureStored().then((id) => id && setEditing(true)) },
            {
              id: 'delete',
              label: 'Delete',
              group: 'danger',
              icon: 'delete',
              danger: true,
              disabled: busy,
              run: () => (doc.storeId ? void remove() : void removeLegacy()),
            },
          ],
        }
  );

  // Meta (FLUX-125, Hearth §6 Document row): type, then one fact. A
  // document with an expiry shows when it expires (warn < 30d), since that
  // is what it is filed for; otherwise how long ago it was added.
  const expiryDays = expiryDaysOf(doc);
  const expiry = expiryDays != null && doc.expiryDate ? documentExpiryLabel(expiryDays, doc.expiryDate) : null;
  const added = timeAgo(doc.createdAt);
  const TypeGlyph = DOC_TYPE_GLYPH[doc.docType] ?? FileText;
  const metaFields = metadataSummary(doc.docType, doc.metadata);
  // Footer: who filed it, and where it came from when that isn't a capture
  // here. A legacy file names the bill or receipt it belongs to, as plain
  // text: it has no portal to open (PC1).
  const origin = doc.impliedEntity
    ? serviceLabel(doc.impliedEntity.type, doc.impliedEntity.id, costNames)
    : doc.source !== 'capture' && doc.source !== 'other'
      ? SOURCE_LABEL[doc.source]
      : null;
  const footer = [doc.uploadedBy ? memberLabel(doc.uploadedBy, memberProfiles) : null, origin]
    .filter(Boolean)
    .join(' · ');

  const remove = async () => {
    if (!doc.storeId) return;
    const confirmed = await dialog.confirm({
      title: `Delete "${doc.title || doc.filename}"?`,
      message: 'This removes it from the store.',
      destructive: true,
    });
    if (!confirmed) return;
    onDelete();
  };

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

  const removeLegacy = async () => {
    const confirmed = await dialog.confirm({
      title: `Delete "${doc.title || doc.filename}"?`,
      message: `This removes the file from ${SOURCE_LABEL[doc.source] ?? 'its source'}.`,
      destructive: true,
    });
    if (!confirmed) return;
    onDelete();
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

  // FLUX-271 (Hearth §6 portal contract): tags, reminder, and cost-item links
  // consolidated into ONE PortalChipRow instead of three hand-rolled chip
  // rows. Order: tags, then reminder (if set), then cost links. Only store
  // docs have portals — legacy docs render their own minimal static line
  // below instead (they have nothing to filter/open).
  const portalChips: PortalChipDef[] = doc.storeId
    ? [
        ...doc.tags.map((t) => ({
          key: `tag-${t}`,
          label: `#${t}`,
          tone: 'neutral' as const,
          onOpen: () => onToggleTag(t),
        })),
        ...(reminderTaskId && onOpenReminder
          ? [{
              key: 'reminder',
              icon: <CalendarClock className="h-3 w-3" />,
              label: 'Reminder',
              // PC5 (FLUX-1554): navigates away to /tasks — leaves the section.
              tone: 'accent' as const,
              onOpen: () => onOpenReminder(reminderTaskId),
            }]
          : []),
        ...docLinks.map((link) => ({
          key: `link-${link.id}`,
          label: serviceLabel(link.entity_type, link.entity_id, costNames),
          // PC5 (FLUX-1554): navigates away to the linked item's section (or recipe).
          tone: 'accent' as const,
          onOpen: () => onOpenLink(link),
        })),
      ]
    : [];

  return (
    <ListItem
      className={cn(
        'items-start px-3.5 py-3 cursor-pointer select-none [-webkit-touch-callout:none]',
        rowMotionClass(motion)
      )}
      // M3: tapping the row opens the file. Clicks from the portalled menu
      // and sheets bubble here through React's tree, so only a click that
      // landed on the row itself counts.
      onClick={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) return;
        if (selecting) onToggleSelect();
        else setPreviewing(true);
      }}
      aria-selected={selecting ? selected : undefined}
      // Legacy files get the same hold-to-edit menu; ensureStored adopts one
      // the first time an action needs a store row.
      holdProgress={longPress.progress}
      {...withRowMenu(longPress.handlers, rowMenu)}
    >
      {rowMenu.menu}
      <ListItemLeading>
        {/* Select mode swaps the type glyph for its tick, same place and
            size as Costs' select mode. */}
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {selecting ? (
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border-2',
                selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
              )}
            >
              {selected && <Check className="h-3 w-3" />}
            </span>
          ) : (
            <TypeGlyph />
          )}
        </span>
      </ListItemLeading>
      <ListItemContent className="gap-0.5">
        {/* The keyboard path to the preview (a pointer taps the row). Not a
            <button>: a hold that starts on the title must still open the
            menu, and NO_HOLD skips buttons. */}
        <span
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (selecting) onToggleSelect();
              else setPreviewing(true);
            }
          }}
          className="block min-w-0 w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ListItemTitle>{doc.title || doc.filename}</ListItemTitle>
        </span>
        {/* Meta grammar (§6 Document row, H6): type, one dot, one fact.
            HOUP-253: no flex-nowrap, so a long fragment wraps on a phone. */}
        <ListItemMeta>
          <span>
            {docTypeLabel(doc.docType)}
            {' · '}
            {expiry ? (
              <span className={EXPIRY_TONE_CLASS[expiry.tone]}>{expiry.text}</span>
            ) : (
              (added ? added.replace(/^Just now$/, 'just now') : 'just now')
            )}
          </span>
        </ListItemMeta>

        {/* Per-category sub-fields, read-only (FLUX-133), as one quiet line. */}
        {metaFields.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">
            {metaFields.map((f) => `${f.label} ${documentMetadataValue(f.value)}`).join(', ')}
          </p>
        )}

        {/* Portal line (FLUX-271, Hearth §6 PC): tags filter in place, the
            reminder and cost links leave the section. Legacy files have no
            portals; what they belong to reads in the footer instead. */}
        {!selecting && doc.storeId && portalChips.length > 0 && (
          // FLUX-1554: no fixed overflowTitle — the overflow can mix tags
          // and links, so the component's default "More" fits both.
          <PortalChipRow chips={portalChips} className="mt-1" />
        )}

        {footer && <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{footer}</p>}
      </ListItemContent>

      {!selecting && (
      <ListItemTrailing {...stopRow}>
        {/* FLUX-234: hold anywhere on the row opens this same menu as a bottom
            sheet (see longPress above); the trigger covers non-touch users. */}
          <PopMenu
            align="right"
            triggerClassName="-mr-1.5 -mt-1 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            triggerLabel="More actions"
            trigger={<MoreHorizontal className="h-4 w-4" />}
            open={holdMenuOpen}
            onOpenChange={setHoldMenuOpen}
            mobileSheet
            previewContent={
              <>
                <TypeGlyph className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {doc.title || doc.filename}
                </span>
              </>
            }
          >
            {(close) => (
              <>
                {/* FLUX-271: the in-row "+ Link" add-button was retired (Hearth: add
                    buttons belong to the editor) — linking to a cost item now lives in
                    this edit sheet's "Linked costs" field. */}
                <MenuItem icon={<ListChecks className="h-3.5 w-3.5" />} onClick={() => { close(); onSelect(); }}>
                  Select
                </MenuItem>
                <MenuItem
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  onClick={() => {
                    close();
                    void ensureStored().then((id) => id && setEditing(true));
                  }}
                >
                  Edit details
                </MenuItem>
                {/* FLUX-271: the in-row "+ Reminder" add-button was retired — creating a
                    reminder for a doc without one lives here instead (a reminder tied
                    to an expiry date is created/kept in sync from the edit sheet). */}
                {!reminderTaskId && (
                  <MenuItem icon={<CalendarClock className="h-3.5 w-3.5" />} onClick={() => { close(); void createReminder(); }}>
                    Set reminder
                  </MenuItem>
                )}
                <MenuItem
                  icon={<FolderInput className="h-3.5 w-3.5" />}
                  onClick={() => {
                    close();
                    void ensureStored().then((id) => id && onMoveToFolder(id));
                  }}
                >
                  Move to folder
                </MenuItem>
                {onAddToCalendar && (
                  <MenuItem
                    icon={<CalendarPlus className="h-3.5 w-3.5" />}
                    onClick={() => {
                      close();
                      void ensureStored().then((id) => id && onAddToCalendar(id));
                    }}
                  >
                    Add to calendar
                  </MenuItem>
                )}
                <MenuItem icon={<Share2 className="h-3.5 w-3.5" />} onClick={() => { close(); void share(); }}>
                  Share
                </MenuItem>
                {/* The row's own tap previews; this is its name in the menu,
                    where the retired trailing preview icon used to be. */}
                <MenuItem icon={<Eye className="h-3.5 w-3.5" />} onClick={() => { close(); setPreviewing(true); }}>
                  Preview
                </MenuItem>
                <MenuDivider />
                <MenuItem danger disabled={busy} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { close(); if (doc.storeId) remove(); else removeLegacy(); }}>
                  Delete
                </MenuItem>
              </>
            )}
          </PopMenu>
      </ListItemTrailing>
      )}

      {/* The preview portals to the body, but React still bubbles its
          events through this row: its clicks (the backdrop's close among
          them) must not reach the row and reopen it, nor start a hold. */}
      {previewing && (
        <div className="contents" {...stopRow}>
          <DocumentPreview
            filename={doc.filename}
            storagePath={doc.storagePath}
            bucket={doc.bucket}
            label={doc.title}
            onClose={() => setPreviewing(false)}
          />
        </div>
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
    </ListItem>
  );
}
