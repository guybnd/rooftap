// HOUP-83: native port of the row portion of apps/web/src/app/documents/page.tsx's
// `DocumentCard`. Hearth §6 Document row grammar: the doc type as a glyph on
// a neutral tile leading, `type · one fact` meta (when it expires, warn
// < 30d, else how long ago it was added), and a PortalChipRow second line
// (tags -> filter in place, reminder, cost links), then who filed it. M3:
// tap opens preview, long-press (+ a trailing "more" button as the visible
// path) opens a BottomSheet actions menu. Legacy (non-store) files get the
// same menu; their first action adopts them into the store. The menu's Select
// starts the screen's select mode, where a tap ticks the row instead.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import {
  BookOpen,
  CalendarClock,
  CalendarPlus,
  Car,
  Check,
  Eye,
  FileText,
  HeartPulse,
  IdCard,
  FolderInput,
  Image as ImageIcon,
  Key,
  Landmark,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Receipt,
  Share2,
  Shield,
  ShieldCheck,
  Signature,
  Trash2,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';
import {
  Text,
  BottomSheet,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  PortalChipRow,
  cn,
  haptics,
  useHoldFill,
  type PortalChipDef,
} from '@homeup/ui';
import {
  SOON_DAYS,
  SOURCE_LABEL,
  docTypeLabel,
  expiryDaysOf,
  metadataSummary,
  serviceLabel,
  timeAgo,
  documentMetadataValue,
  type DocumentLink,
  type UnifiedDocument,
} from '@homeup/core';

function memberLabel(
  userId: string | null,
  profiles: Record<string, { email: string; name: string | null; avatar: string | null }>
): string {
  if (!userId) return 'Unassigned';
  const profile = profiles[userId];
  if (!profile) return 'Former member';
  return profile.name || profile.email || 'Member';
}

// Hearth §6 Document row: the leading chip is the doc type, a glyph on a
// neutral inset tile. Type is identity, not state, and v2 retired per-type
// tint rings, so it takes no hue (H2). Same glyphs as web's page.tsx.
const DOC_TYPE_GLYPH: Record<string, LucideIcon> = {
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

/**
 * The row's expiry fragment (H6: relative when near, a short date when far,
 * never raw ISO). Only expired and soon take a status hue, as a word (H2).
 * Mirrors web's page.tsx.
 */
function expiryLabel(days: number, expiryDate: string): { text: string; className: string } {
  const date = new Date(`${expiryDate.slice(0, 10)}T00:00:00`);
  if (days < 0) {
    const ago = -days;
    return {
      text: ago <= SOON_DAYS
        ? `expired ${ago}d ago`
        : `expired ${date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`,
      className: 'text-destructive',
    };
  }
  if (days === 0) return { text: 'expires today', className: 'text-warning' };
  if (days === 1) return { text: 'expires tomorrow', className: 'text-warning' };
  if (days <= SOON_DAYS) return { text: `expires in ${days}d`, className: 'text-warning' };
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return {
    text: `expires ${date.toLocaleDateString(
      'en-US',
      sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' }
    )}`,
    className: 'text-muted-foreground',
  };
}

// HOUP-230/HOUP-198: matches task-row.tsx/setup-item-card.tsx's hold-to-edit
// timing. This row has no SwipeActions to arbitrate against, so the fill is
// driven straight off ListItem's own onPressIn/onPressOut — no Pan-gesture
// conflict to route around (see HOUP-198's task-row.tsx header comment).
const LONG_PRESS_MS = 500;

interface DocumentRowProps {
  doc: UnifiedDocument;
  costLinks: DocumentLink[];
  costNames: Record<string, string>;
  memberProfiles: Record<string, { email: string; name: string | null; avatar: string | null }>;
  reminderTaskId: string | null;
  onPreview: (doc: UnifiedDocument) => void;
  onEdit: (doc: UnifiedDocument) => void;
  onDelete: (doc: UnifiedDocument) => void;
  onDeleteLegacy: (doc: UnifiedDocument) => void;
  onSetReminder: (doc: UnifiedDocument) => void;
  onShare: (doc: UnifiedDocument) => void;
  onToggleTag: (tag: string) => void;
  /** Null when the document cannot be filed (legacy, not yet adopted). */
  onMoveToFolder: (() => void) | null;
  /** Documents' "Add to calendar" (calendar.event-documents); null hides it. */
  onAddToCalendar?: (() => void) | null;
  /** Null when the reminder's task can't be opened (Tasks off). */
  onOpenReminder: ((taskId: string) => void) | null;
  onOpenLink: (link: Pick<DocumentLink, 'entity_type' | 'entity_id'>) => void;
  /** Starts select mode with this document ticked; absent where there is none. */
  onSelect?: (doc: UnifiedDocument) => void;
  /** Select mode: a tap or a hold ticks the row instead of opening it. */
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: (doc: UnifiedDocument) => void;
}

export function DocumentRow({
  doc,
  costLinks,
  costNames,
  memberProfiles,
  reminderTaskId,
  onPreview,
  onEdit,
  onDelete,
  onDeleteLegacy,
  onSetReminder,
  onShare,
  onToggleTag,
  onMoveToFolder,
  onAddToCalendar,
  onOpenReminder,
  onOpenLink,
  onSelect,
  selecting = false,
  selected = false,
  onToggleSelect,
}: DocumentRowProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const expiryDays = expiryDaysOf(doc);
  const expiry = expiryDays != null && doc.expiryDate ? expiryLabel(expiryDays, doc.expiryDate) : null;
  const added = timeAgo(doc.createdAt);
  const TypeGlyph = DOC_TYPE_GLYPH[doc.docType] ?? FileText;
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
  const holdFill = useHoldFill(LONG_PRESS_MS);

  // PC5: reminder + cost-link chips navigate away from Documents (to Tasks /
  // Costs / Groceries / Setup / Calendar), so they carry the "portal leaves
  // the section" accent tone; tags stay neutral (filter-in-place, PC5).
  const portalChips: PortalChipDef[] = doc.storeId
    ? [
        ...doc.tags.map((t) => ({ key: `tag-${t}`, label: `#${t}`, tone: 'neutral' as const, onOpen: () => onToggleTag(t) })),
        ...(reminderTaskId && onOpenReminder
          ? [{
              key: 'reminder',
              icon: <CalendarClock size={12} className="text-primary" />,
              label: 'Reminder',
              tone: 'accent' as const,
              onOpen: () => onOpenReminder(reminderTaskId),
            }]
          : []),
        ...costLinks.map((link) => ({
          key: `link-${link.id}`,
          label: serviceLabel(link.entity_type, link.entity_id, costNames),
          tone: 'accent' as const,
          onOpen: () => onOpenLink(link),
        })),
      ]
    : [];

  const meta = metadataSummary(doc.docType, doc.metadata);

  return (
    <ListItem
      // Docs sharing a cost sit next to each other; the order is the pairing,
      // so no coloured rail marks it (retired, Hearth §3).
      className="items-start"
      // In select mode a tap or a hold ticks the row; the menu waits until
      // selecting ends.
      onPress={() => (selecting ? onToggleSelect?.(doc) : onPreview(doc))}
      // Legacy files get the same hold-to-edit menu: the screen adopts one into
      // the store the first time an action needs a store row.
      onLongPress={() => {
        if (selecting) {
          onToggleSelect?.(doc);
          return;
        }
        haptics.commit();
        setMenuOpen(true);
      }}
      onPressIn={selecting ? undefined : holdFill.start}
      onPressOut={selecting ? undefined : holdFill.stop}
      holdProgress={selecting ? undefined : holdFill.progress}
      accessibilityState={selecting ? { selected } : undefined}
    >
      <ListItemLeading>
        {/* Select mode swaps the type tile for its tick, same place and size
            as Costs' select mode. */}
        <View className="h-9 w-9 items-center justify-center rounded-xl bg-muted">
          {selecting ? (
            <View
              className={cn(
                'h-5 w-5 items-center justify-center rounded-full border-2',
                selected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
              )}
            >
              {selected && <Check size={12} className="text-primary-foreground" />}
            </View>
          ) : (
            <TypeGlyph size={16} className="text-muted-foreground" />
          )}
        </View>
      </ListItemLeading>
      <ListItemContent className="gap-0.5">
        <ListItemTitle>{doc.title || doc.filename}</ListItemTitle>
        {/* Meta grammar (§6 Document row, H6): type, one dot, one fact. */}
        <ListItemMeta>
          <Text className="text-caption text-muted-foreground">{docTypeLabel(doc.docType)}</Text>
          {expiry ? (
            <Text className={cn('text-caption', expiry.className)}>{expiry.text}</Text>
          ) : (
            <Text className="text-caption text-muted-foreground">
              {added ? added.replace(/^Just now$/, 'just now') : 'just now'}
            </Text>
          )}
        </ListItemMeta>

        {meta.length > 0 && (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {meta.map((f) => `${f.label} ${documentMetadataValue(f.value)}`).join(', ')}
          </Text>
        )}

        {/* Legacy files have no portals; what they belong to reads in the
            footer instead. */}
        {!selecting && doc.storeId && portalChips.length > 0 && (
          <PortalChipRow chips={portalChips} className="mt-1" overflowTitle="Document" />
        )}

        {footer ? (
          <Text className="mt-0.5 text-xs text-muted-foreground/80" numberOfLines={1}>
            {footer}
          </Text>
        ) : null}
      </ListItemContent>

      {!selecting && (
        <ListItemTrailing>
          <Pressable
            onPress={() => setMenuOpen(true)}
            hitSlop={6}
            accessibilityLabel="More actions"
            accessibilityRole="button"
            className="-mr-1.5 -mt-1 h-9 w-9 items-center justify-center rounded-full"
          >
            <MoreHorizontal size={16} className="text-muted-foreground" />
          </Pressable>
        </ListItemTrailing>
      )}

      <BottomSheet open={menuOpen} onOpenChange={setMenuOpen} className="pb-2">
        <View className="flex-row items-center gap-2.5 border-b border-border px-4 pb-3">
          <TypeGlyph size={18} className="shrink-0 text-muted-foreground" />
          <Text numberOfLines={1} className="flex-1 text-body font-medium text-foreground">
            {doc.title || doc.filename}
          </Text>
        </View>
        <ListGroup className="mx-1.5 mt-1.5 border-0 bg-transparent">
          {onSelect && (
            <ListItem onPress={() => { setMenuOpen(false); onSelect(doc); }}>
              <ListItemLeading><ListChecks size={16} className="text-foreground" /></ListItemLeading>
              <ListItemTitle>Select</ListItemTitle>
            </ListItem>
          )}
          <ListItem onPress={() => { setMenuOpen(false); onEdit(doc); }}>
            <ListItemLeading><Pencil size={16} className="text-foreground" /></ListItemLeading>
            <ListItemTitle>Edit details</ListItemTitle>
          </ListItem>
          {!reminderTaskId && (
            <ListItem onPress={() => { setMenuOpen(false); onSetReminder(doc); }}>
              <ListItemLeading><CalendarClock size={16} className="text-foreground" /></ListItemLeading>
              <ListItemTitle>Set reminder</ListItemTitle>
            </ListItem>
          )}
          {onMoveToFolder && (
            <ListItem onPress={() => { setMenuOpen(false); onMoveToFolder(); }}>
              <ListItemLeading><FolderInput size={16} className="text-foreground" /></ListItemLeading>
              <ListItemTitle>Move to folder</ListItemTitle>
            </ListItem>
          )}
          {onAddToCalendar && (
            <ListItem onPress={() => { setMenuOpen(false); onAddToCalendar(); }}>
              <ListItemLeading><CalendarPlus size={16} className="text-foreground" /></ListItemLeading>
              <ListItemTitle>Add to calendar</ListItemTitle>
            </ListItem>
          )}
          <ListItem onPress={() => { setMenuOpen(false); onShare(doc); }}>
            <ListItemLeading><Share2 size={16} className="text-foreground" /></ListItemLeading>
            <ListItemTitle>Share</ListItemTitle>
          </ListItem>
          <ListItem onPress={() => { setMenuOpen(false); onPreview(doc); }}>
            <ListItemLeading><Eye size={16} className="text-foreground" /></ListItemLeading>
            <ListItemTitle>Preview</ListItemTitle>
          </ListItem>
          <View className="my-1 h-px bg-border" />
          <ListItem onPress={() => { setMenuOpen(false); (doc.storeId ? onDelete : onDeleteLegacy)(doc); }}>
            <ListItemLeading><Trash2 size={16} className="text-destructive" /></ListItemLeading>
            <ListItemTitle className="text-destructive">Delete</ListItemTitle>
          </ListItem>
        </ListGroup>
      </BottomSheet>
    </ListItem>
  );
}
