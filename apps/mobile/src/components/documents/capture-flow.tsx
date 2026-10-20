// HOUP-83/HOUP-94: native capture flow for a new document. Source step (take
// photo / choose photo / choose file) -> category step (Invoice / Grocery
// Bill / Document / Other) -> the matching pipeline: Invoice routes to a new
// or existing Costs line, Grocery Bill attaches to today's grocery session,
// Document/Other fall through to the details step (category/name/expiry/
// tags/metadata) -> core uploadDocument. Picking more than one file at once
// skips category entirely and goes straight to the multi-file confirm step
// (always filed as plain Documents, never Invoice/Grocery).
//
// Entry point is a screen-level primary "Add document" action in the content
// bottom-half (Hearth M1 forbids a second FAB) — the tab-bar CaptureFab
// (components/nav/capture-fab.tsx) is a separate, still-stubbed shell
// composite; it will call this same flow once it lands.
//
// Upload body (the plan-review's flagged technical risk): a raw
// fetch-to-Blob from an Expo file `uri` has historically been flaky on RN —
// the robust path used here is expo-file-system's base64 read ->
// base64-arraybuffer decode -> ArrayBuffer, the documented Supabase+Expo
// upload pattern.
//
// HOUP-265: <ShareIntentHandler/> (components/share-intent-handler.tsx) also
// mounts this component, passing `initialShare` for an Android photo/file
// share-in — this IS the share action picker (see `SHARE_CATEGORIES` below),
// not a separate sheet, per that ticket's plan.
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { useRouter } from 'expo-router';
import { Building2, Camera, File as FileIcon, Image as ImageIcon, Receipt, ShoppingCart, FileText } from 'lucide-react-native';
import {
  Text,
  BottomSheet,
  BottomSheetScrollView,
  Button,
  DateScrollField,
  Input,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  SearchablePicker,
  SegmentedControl,
  TagInput,
  haptics,
} from '@homeup/ui';
import {
  createOneOffCostItem,
  listCostItems,
  costItemsToOptions,
  ensureSession,
  fetchTodaySession,
  updateSession,
  syncSession,
  isBoughtToday,
  uploadReceipt,
  defaultDocName,
  DOC_TYPE_PICKER_OPTIONS,
  EXPIRY_CATEGORIES,
  CATEGORY_FIELDS,
  syncDocumentReminder,
  uploadDocument,
  registerDocument,
  linkDocument,
  validateDocumentMeta,
  groceryItems$,
  getEnabledModules,
  isCaptureCategoryEnabled,
  isFeatureEnabled,
  useModules,
  type CostItem,
  type DocType,
  type Document,
  DOCUMENT_MAX_LABEL,
  type DocumentUploadInput,
  type GroceryItem,
} from '@homeup/core';
import { getCurrentSupabaseClient } from '@/lib/supabase-client';
import { setPendingShareImages } from '@/lib/share-ingest';
import { MetadataSubForm } from './metadata-subform';
import { useOpenRoute } from '@/lib/tab-routes';

// Invoice/receipt still aren't offered as plain Document categories here —
// they're routed via the dedicated Invoice/Grocery Bill category tiles below.
const CAPTURE_DOC_TYPE_OPTIONS = DOC_TYPE_PICKER_OPTIONS.filter(
  (o) => o.value !== 'invoice' && o.value !== 'receipt'
);

type Category = 'invoice' | 'grocery' | 'document' | 'other' | 'apartment';

// HOUP-226: exported so the grocery session panel's receipt affordance
// (apps/mobile/src/app/(tabs)/groceries/index.tsx) can reuse the same
// camera/library/file pickers instead of a second implementation.
export interface PickedFile {
  uri: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
}

export type PickResult = { files: PickedFile[]; permissionDenied: boolean };

export async function pickFromCamera(): Promise<PickResult> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { files: [], permissionDenied: true };
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
  if (result.canceled || !result.assets?.[0]) return { files: [], permissionDenied: false };
  const asset = result.assets[0];
  return {
    files: [{
      uri: asset.uri,
      filename: asset.fileName ?? `photo-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
      sizeBytes: asset.fileSize ?? 0,
    }],
    permissionDenied: false,
  };
}

export async function pickFromLibrary(): Promise<PickResult> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { files: [], permissionDenied: true };
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: true });
  if (result.canceled || !result.assets?.length) return { files: [], permissionDenied: false };
  return {
    files: result.assets.map((asset) => ({
      uri: asset.uri,
      filename: asset.fileName ?? `photo-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
      sizeBytes: asset.fileSize ?? 0,
    })),
    permissionDenied: false,
  };
}

export async function pickFromFiles(): Promise<PickResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    copyToCacheDirectory: true,
    multiple: true,
  });
  if (result.canceled || !result.assets?.length) return { files: [], permissionDenied: false };
  return {
    files: result.assets.map((asset) => ({
      uri: asset.uri,
      filename: asset.name,
      mimeType: asset.mimeType ?? null,
      sizeBytes: asset.size ?? 0,
    })),
    permissionDenied: false,
  };
}

async function readFileBody(uri: string): Promise<ArrayBuffer> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return decode(base64);
}

/**
 * Upload payload for the documents store. A local file:// copy (the pickers'
 * cache copies) goes by uri so R2 uploads stream from disk and big files never
 * sit in JS memory (.docs/r2-storage.md). Anything else, such as a shared
 * content:// uri, is read into memory as before.
 */
async function documentInput(uri: string, filename: string, mimeType: string | null): Promise<DocumentUploadInput> {
  if (uri.startsWith('file://')) {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && typeof info.size === 'number' && info.size > 0) {
      return { uri, filename, mimeType, sizeBytes: info.size };
    }
  }
  const body = await readFileBody(uri);
  return { body, filename, mimeType, sizeBytes: body.byteLength };
}

/** One row in the multi-file confirm step. */
interface MultiRow {
  name: string;
  nameEdited: boolean;
  docType: DocType;
  expiry: string;
  tags: string[];
}

const CATEGORIES: { id: Category; label: string; hint: string; icon: typeof Receipt }[] = [
  { id: 'invoice', label: 'Invoice', hint: 'Bill or receipt → Costs', icon: Receipt },
  { id: 'grocery', label: 'Grocery Bill', hint: "Today's shop → Groceries", icon: ShoppingCart },
  { id: 'document', label: 'Document', hint: 'Warranty, manual, contract…', icon: FileText },
  { id: 'other', label: 'Other', hint: 'Anything else', icon: FileIcon },
];

// HOUP-265: the share-in action picker IS this category step, entered
// directly via `initialShare` — a distinct row set/labels from the in-app
// CATEGORIES above (an added "Add apartment listing" action, and copy that
// reads as a share-time choice rather than a document sub-type). "Apartment
// listing" special-routes (stage the image + `/apartment/new`) instead of
// going through `uploadDocument` like the other three.
const SHARE_CATEGORIES: { id: Category; label: string; hint: string; icon: typeof Receipt }[] = [
  { id: 'document', label: 'Save doc', hint: 'Store and tag it', icon: FileText },
  { id: 'invoice', label: 'Add a cost', hint: 'Bill or receipt → Costs', icon: Receipt },
  { id: 'grocery', label: 'Add grocery bill', hint: "Today's shop → Groceries", icon: ShoppingCart },
  { id: 'apartment', label: 'Add apartment listing', hint: 'New home search listing', icon: Building2 },
];

/** HOUP-265: a file already picked up by <ShareIntentHandler/> from the
 * Android share sheet — passed by value (this component tree is mounted at
 * the root alongside the picker, never navigated to), so no expo-router
 * param/share-ingest hand-off is needed for it, unlike the .ics/apartment-
 * listing paths which do cross a screen boundary. */
export interface CaptureFlowInitialShare {
  files: { uri: string; filename: string; mimeType: string | null }[];
}

interface CaptureFlowProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  groupTags: string[];
  onUploaded: (doc: Document) => void;
  /** HOUP-265: when set, skips the `source` step and opens directly at
   * `category` (one file) or `multi` (2+ files) with these file(s) already
   * loaded, and swaps in SHARE_CATEGORIES (adds "Add apartment listing"). */
  initialShare?: CaptureFlowInitialShare;
}

type Step = 'source' | 'category' | 'invoice' | 'details' | 'multi';

export function CaptureFlow({ open, onClose, groupId, groupTags, onUploaded, initialShare }: CaptureFlowProps) {
  const router = useRouter();
  const openRoute = useOpenRoute();
  // Modules: Invoice needs costs (and documents, for the linked bill file),
  // Grocery Bill needs groceries, Document and Other need documents, the
  // apartment listing needs search (module-features.ts).
  const modules = useModules();
  const categories = (initialShare ? SHARE_CATEGORIES : CATEGORIES).filter((c) =>
    isCaptureCategoryEnabled(c.id, modules.feature)
  );
  const [step, setStep] = React.useState<Step>('source');
  const [picked, setPicked] = React.useState<PickedFile | null>(null);
  const [docType, setDocType] = React.useState<DocType>('other');
  const [name, setName] = React.useState('');
  const [nameEdited, setNameEdited] = React.useState(false);
  const [expiry, setExpiry] = React.useState('');
  const [tags, setTags] = React.useState<string[]>([]);
  const [metadata, setMetadata] = React.useState<Record<string, unknown>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [busyLabel, setBusyLabel] = React.useState('Working…');

  // Invoice sub-step state.
  const [attachMode, setAttachMode] = React.useState<'new' | 'existing'>('new');
  const [existingId, setExistingId] = React.useState('');
  const [invCostItems, setInvCostItems] = React.useState<CostItem[]>([]);
  const [invName, setInvName] = React.useState('');
  const [invAmount, setInvAmount] = React.useState(''); // dollars, as typed
  const [invDate, setInvDate] = React.useState(() => new Date().toISOString().slice(0, 10));

  // Multi-file confirm state.
  const [multiFiles, setMultiFiles] = React.useState<PickedFile[]>([]);
  const [rows, setRows] = React.useState<MultiRow[]>([]);

  const reset = React.useCallback(() => {
    setStep('source');
    setPicked(null);
    setDocType('other');
    setName('');
    setNameEdited(false);
    setExpiry('');
    setTags([]);
    setMetadata({});
    setError(null);
    setBusy(false);
    setBusyLabel('Working…');
    setAttachMode('new');
    setExistingId('');
    setInvCostItems([]);
    setInvName('');
    setInvAmount('');
    setInvDate(new Date().toISOString().slice(0, 10));
    setMultiFiles([]);
    setRows([]);
  }, []);

  const close = () => {
    reset();
    onClose();
  };

  // HOUP-265: seed from an already-shared file, skipping `source`. A single
  // file opens the action picker (`category`, with SHARE_CATEGORIES); 2+
  // files skip straight to the existing multi-file confirm grid — same as
  // picking multiple files from the library already does — rather than
  // looping the single-item action picker per file (no Invoice/Grocery/
  // Apartment routing in the multi grid, by design; see the ticket's Risks).
  React.useEffect(() => {
    if (!open || !initialShare || initialShare.files.length === 0) return;
    if (initialShare.files.length === 1) {
      const f = initialShare.files[0];
      setPicked({ uri: f.uri, filename: f.filename, mimeType: f.mimeType, sizeBytes: 0 });
      setStep('category');
    } else {
      const files = initialShare.files.map((f) => ({ uri: f.uri, filename: f.filename, mimeType: f.mimeType, sizeBytes: 0 }));
      setMultiFiles(files);
      setRows(files.map(() => ({ name: defaultDocName('other'), nameEdited: false, docType: 'other' as DocType, expiry: '', tags: [] })));
      setStep('multi');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialShare]);

  const runPicker = async (source: 'camera' | 'library' | 'files') => {
    setError(null);
    const result = await (source === 'camera' ? pickFromCamera() : source === 'library' ? pickFromLibrary() : pickFromFiles());
    if (result.files.length === 0) {
      if (result.permissionDenied) {
        setError(
          source === 'camera'
            ? 'Camera access is needed to take a photo.'
            : 'Photo library access is needed to choose a photo.'
        );
      }
      return;
    }
    if (result.files.length === 1) {
      const file = result.files[0];
      const validationError = validateDocumentMeta({ mimeType: file.mimeType, sizeBytes: file.sizeBytes });
      if (validationError) {
        setError(validationError);
        return;
      }
      setPicked(file);
      setStep('category');
      haptics.tick();
      return;
    }
    const valid = result.files.filter((f) => !validateDocumentMeta({ mimeType: f.mimeType, sizeBytes: f.sizeBytes }));
    const rejected = result.files.length - valid.length;
    if (valid.length === 0) {
      setError(`Those files can't be uploaded (images or PDF, max ${DOCUMENT_MAX_LABEL}).`);
      return;
    }
    setError(rejected > 0 ? `${rejected} file(s) skipped (images or PDF, max ${DOCUMENT_MAX_LABEL}).` : null);
    setMultiFiles(valid);
    setRows(valid.map(() => ({
      name: defaultDocName('other'), nameEdited: false, docType: 'other' as DocType, expiry: '', tags: [],
    })));
    setStep('multi');
    haptics.tick();
  };

  const onCategory = (cat: Category) => {
    if (cat === 'apartment') {
      // HOUP-265: reproduces the pre-picker behavior (stage the image, route
      // to /apartment/new) — special-routed, not through uploadDocument, so
      // it doesn't need the details/invoice/multi steps below.
      if (picked) setPendingShareImages([picked.uri]);
      close();
      router.push('/apartment/new');
      return;
    }
    if (cat === 'document') {
      setDocType('other');
      setName(defaultDocName('other'));
      setNameEdited(false);
      setStep('details');
    } else if (cat === 'other') {
      setDocType('photo');
      setName(defaultDocName('photo'));
      setNameEdited(false);
      setStep('details');
    } else if (cat === 'invoice') {
      setStep('invoice');
      setAttachMode('new');
      setExistingId('');
      setInvName('');
      setInvAmount('');
      setInvDate(new Date().toISOString().slice(0, 10));
      setInvCostItems([]);
      const supabase = getCurrentSupabaseClient();
      listCostItems(supabase, groupId).then(setInvCostItems).catch(() => {});
    } else {
      void runGrocery();
    }
  };

  // Keep the default name in sync with category until the user edits it.
  React.useEffect(() => {
    if (step === 'details' && !nameEdited) setName(defaultDocName(docType));
  }, [step, docType, nameEdited]);

  const canSave = !!picked && name.trim().length > 0;

  const save = async () => {
    if (!picked || busy || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = getCurrentSupabaseClient();
      const input = await documentInput(picked.uri, picked.filename, picked.mimeType);
      const validationError = validateDocumentMeta({ mimeType: picked.mimeType, sizeBytes: input.sizeBytes });
      if (validationError) {
        setError(validationError);
        setBusy(false);
        return;
      }
      const doc = await uploadDocument({
        supabase,
        groupId,
        input,
        docType,
        source: 'capture',
        title: name.trim() || undefined,
        expiryDate: expiry || null,
        tags,
        metadata,
      });
      if (expiry) {
        await syncDocumentReminder(supabase, {
          id: doc.id,
          groupId,
          name: name.trim() || doc.filename,
          expiryDate: expiry,
        });
      }
      haptics.success();
      onUploaded(doc);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the document. Please try again.');
      setBusy(false);
    }
  };

  const confirmInvoice = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setBusyLabel('Saving invoice…');
    setError(null);
    try {
      const supabase = getCurrentSupabaseClient();
      const input = await documentInput(picked.uri, picked.filename, picked.mimeType);
      const doc = await uploadDocument({ supabase, groupId, input, docType: 'invoice', source: 'capture', title: invName.trim() || undefined });
      let costItemId = existingId;
      if (attachMode === 'new' || !costItemId) {
        const amountCents = invAmount ? Math.round(parseFloat(invAmount) * 100) : 0;
        const item = await createOneOffCostItem(supabase, groupId, {
          name: invName.trim() || 'Invoice',
          amount: Number.isFinite(amountCents) ? amountCents : 0,
          category: 'other',
          start_date: invDate || null,
        });
        costItemId = item.id;
      }
      await linkDocument({ supabase, documentId: doc.id, groupId, entityType: 'cost_item', entityId: costItemId, linkRole: 'bill' });
      haptics.success();
      onUploaded(doc);
      close();
      openRoute('/costs');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the invoice.');
      setBusy(false);
    }
  };

  const runGrocery = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setBusyLabel("Adding to today's shop…");
    setError(null);
    try {
      const supabase = getCurrentSupabaseClient();
      const items = Object.values(groceryItems$(groupId).get() ?? {}).filter((i): i is GroceryItem => !!i && !i.deleted);
      const summed = items.filter((i) => isBoughtToday(i)).reduce((s, i) => s + (i.last_price ?? i.price_cents ?? 0), 0);
      let session = (await fetchTodaySession(supabase, groupId)) ?? (await ensureSession(supabase, groupId, 'on', summed));
      if (!session) throw new Error("Could not start today's grocery session.");
      const body = await readFileBody(picked.uri);
      const input: DocumentUploadInput = { body, filename: picked.filename, mimeType: picked.mimeType, sizeBytes: body.byteLength };
      const up = await uploadReceipt(supabase, groupId, session.session_date, input);
      if (!up) throw new Error('Receipt upload failed.');
      session = (await updateSession(supabase, session.id, { receipt_path: up.path, receipt_name: up.name })) ?? session;
      session = await syncSession(supabase, session, groupId, summed);
      // Modules: grocery receipts as documents need documents and groceries (module-features.ts).
      let docRow: Document | null = null;
      if (isFeatureEnabled('documents.groceries', getEnabledModules())) {
        docRow = await registerDocument({ supabase, groupId, storagePath: up.path, filename: up.name, docType: 'receipt', source: 'grocery', mimeType: picked.mimeType, sizeBytes: input.sizeBytes });
        await linkDocument({ supabase, documentId: docRow.id, groupId, entityType: 'grocery_session', entityId: session.id, linkRole: 'receipt' });
      }
      haptics.success();
      if (docRow) onUploaded(docRow);
      close();
      openRoute('/groceries');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the receipt.');
      setBusy(false);
    }
  };

  const updateRow = (i: number, patch: Partial<MultiRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const applyCategoryToAll = (dt: DocType) =>
    setRows((prev) => prev.map((r) => ({
      ...r, docType: dt, name: r.nameEdited ? r.name : defaultDocName(dt),
    })));

  const confirmMulti = async () => {
    if (multiFiles.length === 0 || busy) return;
    setBusy(true);
    setBusyLabel(`Saving ${multiFiles.length} documents…`);
    setError(null);
    const supabase = getCurrentSupabaseClient();
    let ok = 0;
    let lastDoc: Document | null = null;
    for (let i = 0; i < multiFiles.length; i++) {
      const f = multiFiles[i];
      const row = rows[i];
      try {
        const input = await documentInput(f.uri, f.filename, f.mimeType);
        const doc = await uploadDocument({ supabase, groupId, input, docType: row.docType, source: 'capture', title: row.name.trim() || undefined, expiryDate: row.expiry || null, tags: row.tags });
        if (row.expiry) await syncDocumentReminder(supabase, { id: doc.id, groupId, name: row.name.trim() || f.filename, expiryDate: row.expiry });
        ok++;
        lastDoc = doc;
      } catch {
        // best-effort loop — continue with the rest.
      }
    }
    if (ok > 0 && lastDoc) {
      haptics.success();
      onUploaded(lastDoc);
      close();
    } else {
      setError('None of the documents could be saved. Please try again.');
      setBusy(false);
    }
  };

  const hasMetadataFields = !!CATEGORY_FIELDS[docType];
  const backFromStep: Record<Exclude<Step, 'source'>, Step> = {
    category: 'source',
    multi: 'source',
    invoice: 'category',
    details: 'category',
  };
  const goBack = () => {
    const prev = backFromStep[step as Exclude<Step, 'source'>];
    if (prev === 'source') setPicked(null);
    setStep(prev);
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      className="max-h-[88%]"
    >
      {busy ? (
        <View className="items-center justify-center gap-3 px-4 py-14">
          <ActivityIndicator />
          <Text className="text-body text-muted-foreground">{busyLabel}</Text>
        </View>
      ) : step === 'source' ? (
        <View className="gap-4 px-4 pb-2 pt-1">
          <Text className="font-heading text-title font-medium text-foreground">Add document</Text>
          {error && <Text className="text-caption text-destructive">{error}</Text>}
          <ListGroup>
            <ListItem onPress={() => void runPicker('camera')}>
              <ListItemLeading>
                <Camera size={18} className="text-foreground" />
              </ListItemLeading>
              <ListItemTitle>Take photo</ListItemTitle>
            </ListItem>
            <ListItem onPress={() => void runPicker('library')}>
              <ListItemLeading>
                <ImageIcon size={18} className="text-foreground" />
              </ListItemLeading>
              <ListItemTitle>Choose photo</ListItemTitle>
            </ListItem>
            <ListItem onPress={() => void runPicker('files')}>
              <ListItemLeading>
                <FileIcon size={18} className="text-foreground" />
              </ListItemLeading>
              <ListItemTitle>Choose file</ListItemTitle>
            </ListItem>
          </ListGroup>
        </View>
      ) : step === 'category' ? (
        <View className="gap-4 px-4 pb-2 pt-1">
          <Text className="font-heading text-title font-medium text-foreground">
            {initialShare ? 'Add this to Rooftap' : 'What is this?'}
          </Text>
          {picked && (
            <Text className="text-caption text-muted-foreground" numberOfLines={1}>
              {picked.filename}
            </Text>
          )}
          {error && <Text className="text-caption text-destructive">{error}</Text>}
          <ListGroup>
            {categories.map((c) => (
              <ListItem key={c.id} onPress={() => onCategory(c.id)}>
                <ListItemLeading>
                  <c.icon size={18} className="text-foreground" />
                </ListItemLeading>
                <ListItemContent>
                  <ListItemTitle>{c.label}</ListItemTitle>
                  <ListItemMeta>
                    <Text className="text-caption text-muted-foreground">{c.hint}</Text>
                  </ListItemMeta>
                </ListItemContent>
              </ListItem>
            ))}
          </ListGroup>
          {/* HOUP-265: no `source` step to return to when opened from a share
              — "Back" here would only re-run reset()'s no-op prev='source'. */}
          {!initialShare && (
            <Button variant="outline" onPress={goBack}>
              Back
            </Button>
          )}
        </View>
      ) : step === 'invoice' ? (
        <BottomSheetScrollView contentContainerClassName="gap-4 px-4 pb-2 pt-1">
          <Text className="font-heading text-title font-medium text-foreground">Invoice details</Text>

          <SegmentedControl
            options={[
              { value: 'new', label: 'New cost' },
              { value: 'existing', label: 'Existing' },
            ]}
            value={attachMode}
            onChange={setAttachMode}
            size="sm"
          />

          {attachMode === 'new' ? (
            <>
              <View className="gap-1.5">
                <Text className="text-caption font-medium text-muted-foreground">Name</Text>
                <Input value={invName} onChangeText={setInvName} placeholder="e.g. Origin Energy bill" />
              </View>
              <View className="flex-row gap-2.5">
                <View className="flex-1 gap-1.5">
                  <Text className="text-caption font-medium text-muted-foreground">Amount ($)</Text>
                  <Input value={invAmount} onChangeText={setInvAmount} keyboardType="decimal-pad" placeholder="0.00" />
                </View>
                <View className="flex-1 gap-1.5">
                  <Text className="text-caption font-medium text-muted-foreground">Date</Text>
                  <DateScrollField value={invDate} onChange={setInvDate} />
                </View>
              </View>
            </>
          ) : (
            <View className="gap-1.5">
              <Text className="text-caption font-medium text-muted-foreground">Attach to</Text>
              <SearchablePicker
                options={costItemsToOptions(invCostItems)}
                value={existingId || null}
                onChange={setExistingId}
                placeholder="Select a cost item…"
                searchPlaceholder="Search cost items…"
                emptyText="No cost items yet"
                ariaLabel="Attach to cost item"
              />
            </View>
          )}

          {error && <Text className="text-caption text-destructive">{error}</Text>}

          <View className="flex-row gap-2">
            <Button variant="outline" className="flex-1" onPress={goBack}>
              Back
            </Button>
            <Button
              className="flex-1"
              onPress={() => void confirmInvoice()}
              disabled={attachMode === 'existing' && !existingId}
            >
              Save invoice
            </Button>
          </View>
        </BottomSheetScrollView>
      ) : step === 'multi' ? (
        <BottomSheetScrollView contentContainerClassName="gap-4 px-4 pb-2 pt-1">
          <Text className="font-heading text-title font-medium text-foreground">Add documents</Text>
          <Text className="text-caption text-muted-foreground">
            {multiFiles.length} files: name and file each.
          </Text>

          <View className="gap-1.5">
            <Text className="text-caption font-medium text-muted-foreground">Set all categories</Text>
            <SearchablePicker
              options={CAPTURE_DOC_TYPE_OPTIONS}
              value={null}
              onChange={(v) => applyCategoryToAll(v as DocType)}
              placeholder="Apply a category to all…"
              searchPlaceholder="Search categories…"
              ariaLabel="Apply category to all"
            />
          </View>

          <View className="gap-2.5">
            {multiFiles.map((f, i) => (
              <View key={i} className="gap-2 rounded-xl border border-border p-3">
                <Text className="text-caption text-muted-foreground" numberOfLines={1}>
                  {f.filename}
                </Text>
                <Input
                  value={rows[i]?.name ?? ''}
                  onChangeText={(v) => updateRow(i, { name: v, nameEdited: true })}
                  placeholder="Name"
                />
                <SearchablePicker
                  options={CAPTURE_DOC_TYPE_OPTIONS}
                  value={rows[i]?.docType ?? 'other'}
                  onChange={(v) =>
                    updateRow(i, {
                      docType: v as DocType,
                      ...(rows[i]?.nameEdited ? {} : { name: defaultDocName(v as DocType) }),
                    })
                  }
                  placeholder="Category"
                  searchPlaceholder="Search categories…"
                  ariaLabel={`Category for ${f.filename}`}
                />
                <DateScrollField value={rows[i]?.expiry ?? ''} onChange={(v) => updateRow(i, { expiry: v })} />
                <TagInput tags={rows[i]?.tags ?? []} onChange={(t) => updateRow(i, { tags: t })} suggestions={groupTags} />
              </View>
            ))}
          </View>

          {error && <Text className="text-caption text-destructive">{error}</Text>}

          <View className="flex-row gap-2">
            {!initialShare && (
              <Button variant="outline" className="flex-1" onPress={goBack}>
                Back
              </Button>
            )}
            <Button className="flex-1" onPress={() => void confirmMulti()}>
              Save {multiFiles.length} documents
            </Button>
          </View>
        </BottomSheetScrollView>
      ) : (
        <BottomSheetScrollView contentContainerClassName="gap-4 px-4 pb-2 pt-1">
          <Text className="font-heading text-title font-medium text-foreground">Document details</Text>

          <View className="gap-1.5">
            <Text className="text-caption font-medium text-muted-foreground">Name</Text>
            <Input
              value={name}
              onChangeText={(v) => {
                setName(v);
                setNameEdited(true);
              }}
              placeholder="Document name"
            />
          </View>

          <View className="gap-1.5">
            <Text className="text-caption font-medium text-muted-foreground">Category</Text>
            <SearchablePicker
              options={CAPTURE_DOC_TYPE_OPTIONS}
              value={docType}
              onChange={(v) => setDocType(v as DocType)}
              placeholder="Choose a category…"
              searchPlaceholder="Search categories…"
              ariaLabel="Document category"
            />
          </View>

          <View className="gap-1.5">
            <View className="flex-row items-center justify-between">
              <Text className="text-caption font-medium text-muted-foreground">Expiry date</Text>
              <View className="flex-row items-center gap-2">
                {EXPIRY_CATEGORIES.has(docType) ? (
                  <Text className="text-xs text-warning">Recommended</Text>
                ) : (
                  <Text className="text-xs text-muted-foreground">Optional</Text>
                )}
                {expiry !== '' && (
                  <Button size="xs" variant="ghost" onPress={() => setExpiry('')}>
                    Clear
                  </Button>
                )}
              </View>
            </View>
            <DateScrollField value={expiry} onChange={setExpiry} />
          </View>

          {hasMetadataFields && <MetadataSubForm docType={docType} value={metadata} onChange={setMetadata} />}

          <View className="gap-1.5">
            <Text className="text-caption font-medium text-muted-foreground">Tags</Text>
            <TagInput tags={tags} onChange={setTags} suggestions={groupTags} />
          </View>

          {error && <Text className="text-caption text-destructive">{error}</Text>}

          <View className="flex-row gap-2">
            <Button variant="outline" className="flex-1" onPress={goBack}>
              Back
            </Button>
            <Button className="flex-1" onPress={() => void save()} disabled={!canSave}>
              Save
            </Button>
          </View>
        </BottomSheetScrollView>
      )}
    </BottomSheet>
  );
}
