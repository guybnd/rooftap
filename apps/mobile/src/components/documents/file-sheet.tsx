// The Documents file sheet: a tap on a file shows it here before anything
// opens. The file drawn small (an image inline, anything else as its type
// glyph), its four verbs (Open, Edit, Share, Move), its expiry and reminder,
// and its details. The web explorer's preview pane shows the same facts
// (apps/web/src/components/documents/document-inspector.tsx), from the same
// core helpers.
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { BellRing, ExternalLink, FileText, FolderInput, Pencil, Share2, type LucideIcon } from 'lucide-react-native';
import { Text, BottomSheet, Button, cn } from '@homeup/ui';
import {
  documentDetailRows,
  documentExpiryNote,
  serviceLabel,
  signedDocumentUrl,
  SIGNED_URL_TTL_SECONDS,
  SOURCE_LABEL,
  type DocumentFolder,
  type DocumentLink,
  type UnifiedDocument,
} from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { DOC_TYPE_GLYPH, memberLabel } from './document-row';
import { isImageFilename } from './document-preview';

const NOTE_TONE = { expired: 'text-destructive', soon: 'text-warning', later: 'text-foreground' };

/** One of the sheet's four verbs: an icon over its word, all four the same width. */
function Verb({ icon: Icon, label, primary, disabled, onPress }: { icon: LucideIcon; label: string; primary?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={cn(
        'h-16 flex-1 items-center justify-center gap-1 rounded-2xl',
        primary ? 'bg-primary active:bg-primary/80' : 'border border-border bg-background active:bg-muted',
        disabled && 'opacity-50'
      )}
    >
      {disabled && primary ? (
        <ActivityIndicator size="small" />
      ) : (
        <Icon size={18} className={primary ? 'text-primary-foreground' : 'text-foreground'} />
      )}
      <Text className={cn('text-caption font-medium', primary ? 'text-primary-foreground' : 'text-foreground')}>{label}</Text>
    </Pressable>
  );
}

export function DocumentFileSheet({
  doc,
  onClose,
  folders,
  docLinks,
  costNames,
  memberProfiles,
  reminderTaskId,
  opening,
  onOpen,
  onEdit,
  onShare,
  onMove,
  onSetReminder,
  onOpenReminder,
  onOpenLink,
}: {
  /** The file shown; null closes the sheet. */
  doc: UnifiedDocument | null;
  onClose: () => void;
  folders: DocumentFolder[];
  docLinks: DocumentLink[];
  costNames: Record<string, string>;
  memberProfiles: Record<string, { email: string; name: string | null; avatar: string | null }>;
  reminderTaskId: string | null;
  /** The file is opening (a PDF's link is on its way). */
  opening: boolean;
  onOpen: (doc: UnifiedDocument) => void;
  onEdit: (doc: UnifiedDocument) => void;
  onShare: (doc: UnifiedDocument) => void;
  onMove: (doc: UnifiedDocument) => void;
  onSetReminder: (doc: UnifiedDocument) => void;
  /** Null when the reminder's task can't be opened (Tasks off). */
  onOpenReminder: ((taskId: string) => void) | null;
  onOpenLink: (link: Pick<DocumentLink, 'entity_type' | 'entity_id'>) => void;
}) {
  // The last file shown, kept while the sheet slides away.
  const [shown, setShown] = React.useState<UnifiedDocument | null>(doc);
  React.useEffect(() => {
    if (doc) setShown(doc);
  }, [doc]);

  // An image draws inline from a signed link, fetched again for each file.
  // Keyed on where the file lives, not the row object: the list reloads hand
  // the sheet a fresh object for the same file, and each one restarted the fetch.
  // undefined while the link is on its way, null when there is none.
  const [url, setUrl] = React.useState<string | null | undefined>(undefined);
  const image = !!shown && isImageFilename(shown.filename);
  const storagePath = shown?.storagePath ?? null;
  const bucket = shown?.bucket ?? null;
  React.useEffect(() => {
    if (!storagePath || !bucket || !image) return;
    let cancelled = false;
    setUrl(undefined);
    void signedDocumentUrl(getCurrentSupabaseClient(), storagePath, SIGNED_URL_TTL_SECONDS, bucket).then((signed) => {
      if (!cancelled) setUrl(signed);
    });
    return () => {
      cancelled = true;
    };
  }, [storagePath, bucket, image]);

  if (!shown) return null;
  const d = shown;
  const TypeGlyph = DOC_TYPE_GLYPH[d.docType] ?? FileText;
  const note = documentExpiryNote(d);
  const origin = d.impliedEntity
    ? serviceLabel(d.impliedEntity.type, d.impliedEntity.id, costNames)
    : d.source !== 'capture' && d.source !== 'other'
      ? SOURCE_LABEL[d.source]
      : null;
  const details = documentDetailRows(d, {
    folders,
    addedBy: d.uploadedBy ? memberLabel(d.uploadedBy, memberProfiles) : null,
    origin,
  });
  // Each verb closes the sheet first, so the next sheet or viewer has the screen.
  const act = (fn: (doc: UnifiedDocument) => void) => () => {
    onClose();
    fn(d);
  };

  return (
    <BottomSheet open={!!doc} onOpenChange={(next) => { if (!next) onClose(); }} className="max-h-[90%]">
      <ScrollView contentContainerClassName="gap-4 px-4 pb-6">
        <View className="gap-0.5">
          <Text className="font-heading text-title font-semibold text-foreground" numberOfLines={2}>
            {d.title || d.filename}
          </Text>
          {d.title ? (
            <Text numberOfLines={1} className="text-caption text-muted-foreground">
              {d.filename}
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={act(onOpen)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${d.title || d.filename}`}
          className="h-52 items-center justify-center overflow-hidden rounded-2xl bg-muted/60"
        >
          {image && url ? (
            <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          ) : image && url === undefined ? (
            <ActivityIndicator />
          ) : (
            <View className="items-center gap-2">
              <TypeGlyph size={36} className="text-muted-foreground" />
              <Text className="text-caption text-muted-foreground">Tap to open</Text>
            </View>
          )}
        </Pressable>

        <View className="flex-row gap-2">
          <Verb icon={ExternalLink} label="Open" primary disabled={opening} onPress={act(onOpen)} />
          <Verb icon={Pencil} label="Edit" onPress={act(onEdit)} />
          <Verb icon={Share2} label="Share" onPress={() => onShare(d)} />
          <Verb icon={FolderInput} label="Move" onPress={act(onMove)} />
        </View>

        {note || reminderTaskId ? (
          <View className="flex-row items-center gap-3 rounded-2xl bg-muted/60 px-3.5 py-3">
            <BellRing size={16} className={note ? NOTE_TONE[note.tone] : 'text-muted-foreground'} />
            <View className="min-w-0 flex-1">
              {note ? <Text className={cn('text-body font-medium', NOTE_TONE[note.tone])}>{note.text}</Text> : null}
              <Text className="text-caption text-muted-foreground">{reminderTaskId ? 'Reminder set' : 'No reminder yet'}</Text>
            </View>
            {reminderTaskId ? (
              onOpenReminder ? (
                <Button size="sm" variant="ghost" onPress={() => { onClose(); onOpenReminder(reminderTaskId); }}>
                  Open reminder
                </Button>
              ) : null
            ) : (
              <Button size="sm" variant="ghost" onPress={() => onSetReminder(d)}>
                Set reminder
              </Button>
            )}
          </View>
        ) : null}

        <View className="gap-2">
          {details.map((row) => (
            <View key={row.label} className="flex-row gap-3">
              <Text className="w-28 text-body text-muted-foreground">{row.label}</Text>
              <Text className="min-w-0 flex-1 text-body text-foreground">{row.value}</Text>
            </View>
          ))}
          {docLinks.length > 0 ? (
            <View className="flex-row gap-3">
              <Text className="w-28 text-body text-muted-foreground">Linked to</Text>
              <View className="min-w-0 flex-1 gap-1">
                {docLinks.map((link) => (
                  <Pressable key={link.id} onPress={() => { onClose(); onOpenLink(link); }} accessibilityRole="link" hitSlop={6}>
                    <Text className="text-body text-primary">{serviceLabel(link.entity_type, link.entity_id, costNames)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {d.tags.length > 0 ? (
            <View className="flex-row gap-3">
              <Text className="w-28 text-body text-muted-foreground">Tags</Text>
              <Text className="min-w-0 flex-1 text-body text-foreground">{d.tags.map((t) => `#${t}`).join(' ')}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </BottomSheet>
  );
}
