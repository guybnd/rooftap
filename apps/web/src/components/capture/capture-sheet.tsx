"use client";

// FLUX-104: the global capture sheet. Two steps — pick a source (photo/file),
// then a category (Invoice / Grocery Bill / Document / Other) — routing each
// category into the central documents store (src/lib/documents.ts) and linking
// it to the right service. Mounted once at shell level (inside DataCacheProvider
// so it has the active groupId); opened from the desktop "+ Capture" and the
// mobile raised "+".

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { use$ } from "@legendapp/state/react";
import { Camera, Upload, FileText, ShoppingCart, Receipt, File as FileIcon, Loader2, ArrowLeft, Tag, Sparkles, Wallet, ListChecks, ClipboardCheck, Building2, ScanLine, Search, Plus, Check, CalendarDays, ChefHat, ListTodo } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { useCapture } from "@/components/capture/capture-context";
import { getCaptureLauncherCurrentKey } from "@/components/capture/launcher-current";
import { useSectionSettings } from "@/lib/use-section";
import { getEnabledModules, getEnabledSections, getSectionByPath, hiddenWithDisabledModules, isCaptureCategoryEnabled, isFeatureEnabled, looksLikeQuestion, listSetupStores, sectionHue, syncedGroupId, useModules, useReconnectSync, useStoreHelpers, householdTasks$, groceryItems$, costItems$, setupItems$, recipes$ as recipesStore$, checklists$ as checklistsStore$, shopperWants$, apartments$, appointments$, apartmentChecklistItems$ } from "@homeup/core";
import { dialog } from "@homeup/core";
import { useGlobalSearchIndex, resolveGlobalHitAction, type GlobalHit } from "@/hooks/use-global-search-index";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { HOUSEHOLD_TASKS_CHANGED_EVENT } from "@/hooks/use-overdue-task-count";
import { suppressNextSheetTidy } from "@/hooks/use-sheet-gestures";
import { HouseholdTaskModal } from "@/app/tasks/household-task-modal";
import { GroceryItemModal } from "@/app/groceries/grocery-item-modal";
import { useGroceryAux } from "@/app/groceries/use-grocery-aux";
import { CostModal } from "@/app/costs/cost-modal";
import { SetupItemModal } from "@/app/setup/setup-item-modal";
import { CaptureSearchResults } from "@/components/capture/capture-search-results";
import { LeadingTile } from "@/components/ui/leading-tile";
import { toastItemAdded } from "@/lib/added-toast";
import {
  uploadDocument,
  registerDocument,
  linkDocument,
  renameDocument,
  listDocumentTags,
  validateDocumentFile,
  docTypeLabel,
  DOC_TYPE_PICKER_OPTIONS,
  DOCUMENT_ACCEPT_ATTR,
} from "@/lib/documents";
import { createOneOffCostItem, listCostItems, costItemsToOptions } from '@homeup/core';
import { DOCUMENT_MAX_LABEL, syncDocumentReminder, todayISO } from '@homeup/core';
import { SearchablePicker } from "@/components/ui/searchable-picker";
import { TagInput } from "@/components/ui/tag-input";
import { MetadataSubForm } from "@/components/documents/metadata-subform";
import {
  fetchTodaySession,
  ensureSession,
  updateSession,
  applyReceiptLearning,
  syncSession,
  type ParsedReceipt,
} from '@homeup/core';
import { uploadReceipt } from '@/lib/grocery-sessions';
import { parseReceiptFile } from '@/lib/grocery-receipt-parse';
import type { Apartment, Appointment, ChecklistItem, CostItem, DocType, GroceryItem, HouseholdTask, SetupItem, SetupStore, Recipe, Checklist, ShopperWant } from '@homeup/core';

type Step = "launcher" | "source" | "category" | "invoice" | "details" | "multi";

/** One quick-add action on the launcher grid, gated by its owning section. */
interface LauncherAction {
  key: string;
  label: string;
  /** Section id (from sections.ts) whose enablement gates this tile. */
  section: string;
  icon: typeof FileText;
  /** Disable + dim when offline (needs a network round-trip). */
  onlineOnly?: boolean;
  run: () => void;
}
type Category = "invoice" | "grocery" | "document" | "other";

/** One row in the multi-file confirm step (FLUX-117). */
interface MultiRow {
  name: string;
  nameEdited: boolean;
  docType: DocType;
  expiry: string;
  tags: string[];
}

/** Categories where an expiry date is worth prompting for. */
const EXPIRY_CATEGORIES = new Set<DocType>([
  "warranty", "id_personal", "insurance", "vehicle", "lease_contract",
]);

/** Default name: "<Category> – <date>[ – <OCR title>]". */
function defaultDocName(docType: DocType, ocrTitle?: string | null): string {
  const datePart = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  const base = `${docTypeLabel(docType)} – ${datePart}`;
  return ocrTitle ? `${base} – ${ocrTitle}` : base;
}

const CATEGORIES: { id: Category; label: string; hint: string; icon: typeof FileText }[] = [
  { id: "invoice", label: "Invoice", hint: "Bill or receipt → Costs", icon: Receipt },
  { id: "grocery", label: "Grocery Bill", hint: "Today's shop → Groceries", icon: ShoppingCart },
  { id: "document", label: "Document", hint: "Warranty, manual, contract…", icon: FileText },
  { id: "other", label: "Other", hint: "Anything else", icon: FileIcon },
];

export function CaptureSheet() {
  const { open, setOpen, closeCapture } = useCapture();
  const { group, isOnline, currentUserId, groupMembers, memberProfiles } = useDataCache();
  const groupId = group?.id ?? null;
  const groceryAux = useGroceryAux(groupId);
  const router = useRouter();
  // FLUX-193: highlight the launcher action for the section you're currently on,
  // so the "+" surfaces the add-item that matches the page (e.g. To-do on /tasks).
  const pathname = usePathname();
  const currentSectionId = getSectionByPath(pathname)?.id;
  const currentLauncherActionKey = getCaptureLauncherCurrentKey(pathname, currentSectionId);
  const { settings } = useSectionSettings();

  const [step, setStep] = useState<Step>("launcher");

  // Keyboard + autofill-bar inset (iOS Safari): float the bottom sheet above the
  // occluded area and re-measure live so the autofill bar (which grows the
  // keyboard AFTER it opens) doesn't leave results hidden behind it.
  const keyboardInset = useKeyboardInset(open);

  // ── Quick-add launcher (FLUX-174) ──────────────────────────────────────────
  // Shell-level singleton: the "+" is now a general "add anything" launcher, not
  // a file-only wizard. The Legend stores + search index below are gated behind
  // `open` (see the use$ selectors + the groupId passed to useGlobalSearchIndex)
  // so mounting this sheet on every page adds NO always-on sync — a closed sheet
  // never calls .get() on a store nor fetches documents (protects cold-load).
  const [q, setQ] = useState("");

  // Quick-add modal state (shell-mounted; persists after the launcher closes).
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<HouseholdTask | undefined>();
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [groceryModalOpen, setGroceryModalOpen] = useState(false);
  const [editingGrocery, setEditingGrocery] = useState<GroceryItem | undefined>();
  const [newGroceryName, setNewGroceryName] = useState("");
  const [costModalOpen, setCostModalOpen] = useState(false);
  const [editingCost, setEditingCost] = useState<CostItem | undefined>();
  const [newCostName, setNewCostName] = useState("");
  // A setup hit's "Edit details" (the setup card's own editor, shell-mounted
  // like the others) and the household's stores its card and form pick from.
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [editingSetup, setEditingSetup] = useState<SetupItem | undefined>();
  const [setupStores, setSetupStores] = useState<SetupStore[]>([]);

  // The stores need to stay observed while EITHER the launcher or a quick-add
  // modal is open — the launcher for search, the modal so its save writes against
  // an active (hydrated + syncing) store rather than a dormant one.
  const active = open || taskModalOpen || groceryModalOpen || costModalOpen || setupModalOpen;

  // Section gating — enabled = module on for this household AND not
  // user-hidden. Mirrors the canonical check in app-sidebar.tsx.
  const modules = useModules();
  const hiddenOrOff = useMemo(
    () => hiddenWithDisabledModules(settings.hiddenSections, modules.enabled),
    [settings.hiddenSections, modules.enabled]
  );
  const enabledSectionIds = useMemo(() => {
    const hidden = new Set(hiddenOrOff);
    return new Set(getEnabledSections(modules.enabled).filter((s) => !hidden.has(s.id)).map((s) => s.id));
  }, [hiddenOrOff, modules.enabled]);

  // Modules: Invoice needs costs (and documents, for the linked bill file),
  // Grocery Bill needs groceries, Document and Other need documents; the
  // optional cost link on a document needs documents and costs (module-features.ts).
  const captureCategories = CATEGORIES.filter((c) => isCaptureCategoryEnabled(c.id, modules.feature));
  const docCostLinkOn = modules.feature("documents.costs");

  // Legend stores backing the modal-based quick-adds + the search index.
  // Modules (store-modules.ts): a switched-off module's stores open with no
  // group id, so they don't sync; nothing here writes to one, because every
  // quick-add and search hit for it is gone too.
  const syncedGroup = (store$: { collection: string }) => syncedGroupId(store$, groupId, modules.enabled);
  const tasks$ = householdTasks$(syncedGroup(householdTasks$));
  const groceries$ = groceryItems$(syncedGroup(groceryItems$));
  const costs$ = costItems$(syncedGroup(costItems$));
  const setup$ = setupItems$(syncedGroup(setupItems$));
  const recipes$ = recipesStore$(syncedGroup(recipesStore$));
  const checklists$ = checklistsStore$(syncedGroup(checklistsStore$));
  const shopper$ = shopperWants$(syncedGroup(shopperWants$));
  const apartments$store = apartments$(syncedGroup(apartments$));
  const appointments$store = appointments$(syncedGroup(appointments$));
  const apartmentChecklistItems$store = apartmentChecklistItems$(syncedGroup(apartmentChecklistItems$));
  useReconnectSync(tasks$);
  useReconnectSync(groceries$);
  useReconnectSync(costs$);
  useReconnectSync(setup$);
  useReconnectSync(recipes$);
  useReconnectSync(checklists$);
  useReconnectSync(shopper$);
  useReconnectSync(apartments$store);
  useReconnectSync(appointments$store);
  useReconnectSync(apartmentChecklistItems$store);
  const { writeRow: writeTask, patchRow: patchTask, softDeleteRow: softDeleteTask } = useStoreHelpers(tasks$, currentUserId);
  const { writeRow: writeGrocery, softDeleteRow: softDeleteGrocery } = useStoreHelpers(groceries$, currentUserId);
  const { writeRow: writeCost, patchRow: patchCost, softDeleteRow: softDeleteCost } = useStoreHelpers(costs$, currentUserId);
  const { writeRow: writeSetup, patchRow: patchSetup, softDeleteRow: softDeleteSetup } = useStoreHelpers(setup$, currentUserId);

  // Reads gated by `open`: when closed the selector never calls .get(), so the
  // store stays unsubscribed and doesn't sync. Opening the sheet re-runs these.
  const tasks = use$(() =>
    active ? Object.values(tasks$.get() ?? {}).filter((t): t is HouseholdTask => !!t && !t.deleted) : []
  );
  const groceries = use$(() =>
    active ? Object.values(groceries$.get() ?? {}).filter((g): g is GroceryItem => !!g && !g.deleted) : []
  );
  const costItemsList = use$(() =>
    active ? Object.values(costs$.get() ?? {}).filter((c): c is CostItem => !!c && !c.deleted) : []
  );
  const setupItemsList = use$(() =>
    active ? Object.values(setup$.get() ?? {}).filter((s): s is SetupItem => !!s && !s.deleted) : []
  );
  const recipesList = use$(() =>
    active ? Object.values(recipes$.get() ?? {}).filter((r): r is Recipe => !!r && !r.deleted) : []
  );
  const checklistsList = use$(() =>
    active ? Object.values(checklists$.get() ?? {}).filter((c): c is Checklist => !!c && !c.deleted) : []
  );
  const shopperList = use$(() =>
    active ? Object.values(shopper$.get() ?? {}).filter((w): w is ShopperWant => !!w && !w.deleted) : []
  );
  const apartments = use$(() =>
    active ? Object.values(apartments$store.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted) : []
  );
  const appointments = use$(() =>
    active ? Object.values(appointments$store.get() ?? {}).filter((a): a is Appointment => !!a && !a.deleted) : []
  );
  const checklistItems = use$(() =>
    active ? Object.values(apartmentChecklistItems$store.get() ?? {}).filter((c): c is ChecklistItem => !!c && !c.deleted) : []
  );

  const { index: searchIndex, docsLoading } = useGlobalSearchIndex({
    // Empty groupId while closed skips the documents fetch entirely.
    groupId: open ? (groupId ?? "") : "",
    hiddenSections: hiddenOrOff,
    tasks,
    groceries,
    costItems: costItemsList,
    setupItems: setupItemsList,
    appointments: appointments ?? [],
    apartments: apartments ?? [],
    checklistItems: checklistItems ?? [],
    recipes: recipesList,
    checklists: checklistsList,
    shopperWants: shopperList,
  });

  // Setup stores back a setup hit's card (its store chip) and its editor.
  const setupOn = enabledSectionIds.has("setup");
  const wantSetupStores = !!groupId && setupOn && (open || setupModalOpen);
  useEffect(() => {
    if (!wantSetupStores || !groupId) return;
    listSetupStores(createClient(), groupId).then(setSetupStores).catch(() => {});
  }, [wantSetupStores, groupId]);
  const setupRooms = useMemo(
    () => Array.from(new Set(setupItemsList.map((i) => i.room).filter(Boolean))).sort() as string[],
    [setupItemsList]
  );

  // A row inside the results can navigate on its own (a task's checklist
  // chip, a grocery's recipe chip). Close the sheet when the route changes
  // under it; the tidy is suppressed so it can't revert that navigation.
  const openPathname = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      openPathname.current = null;
      return;
    }
    if (openPathname.current === null) {
      openPathname.current = pathname;
      return;
    }
    if (pathname !== openPathname.current) {
      suppressNextSheetTidy();
      closeCapture();
    }
  }, [open, pathname, closeCapture]);

  const bumpBadge = () => window.dispatchEvent(new Event(HOUSEHOLD_TASKS_CHANGED_EVENT));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Working…");
  const [error, setError] = useState<string | null>(null);

  // Invoice sub-step state
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [parsing, setParsing] = useState(false);
  const [costItems, setCostItems] = useState<CostItem[]>([]);
  const [attachMode, setAttachMode] = useState<"new" | "existing">("new");
  const [existingId, setExistingId] = useState<string>("");
  const [invName, setInvName] = useState("");
  const [invAmount, setInvAmount] = useState(""); // dollars, as typed
  const [invDate, setInvDate] = useState(todayISO); // defaults to today; parse overrides

  // Document details sub-step state (FLUX-114)
  const [docName, setDocName] = useState("");
  const [docNameEdited, setDocNameEdited] = useState(false);
  const [docType, setDocType] = useState<DocType>("other");
  const [docExpiry, setDocExpiry] = useState("");
  const [docTags, setDocTags] = useState<string[]>([]);
  const [docMetadata, setDocMetadata] = useState<Record<string, unknown>>({});
  const [docLinkCostId, setDocLinkCostId] = useState("");
  const [docParse, setDocParse] = useState(false);
  const [docParsing, setDocParsing] = useState(false);
  const [docOcrTitle, setDocOcrTitle] = useState<string | null>(null);
  const [docParsedData, setDocParsedData] = useState<unknown>(null);
  const [groupTags, setGroupTags] = useState<string[]>([]);

  // Multi-file confirm state (FLUX-117)
  const [multiFiles, setMultiFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<MultiRow[]>([]);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStep("launcher");
    setQ("");
    setFile(null);
    setBusy(false);
    setError(null);
    setParsed(null);
    setParsing(false);
    setCostItems([]);
    setAttachMode("new");
    setExistingId("");
    setInvName("");
    setInvAmount("");
    setInvDate(todayISO());
    setDocName("");
    setDocNameEdited(false);
    setDocType("other");
    setDocExpiry("");
    setDocTags([]);
    setDocMetadata({});
    setDocLinkCostId("");
    setDocParse(false);
    setDocParsing(false);
    setDocOcrTitle(null);
    setDocParsedData(null);
    setGroupTags([]);
    setMultiFiles([]);
    setRows([]);
  }, []);

  // Reset whenever the sheet closes so it always reopens at step 1.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  // ── Launcher openers (FLUX-174) ────────────────────────────────────────────
  // Opening a quick-add modal closes the launcher sheet; the modal is mounted at
  // shell level (below) so it stays up after the sheet's close animation.
  const openAddTask = (name = "") => {
    setEditingTask(undefined);
    setNewTaskTitle(name);
    setTaskModalOpen(true);
    closeCapture();
  };
  const openAddGrocery = (name = "") => {
    setEditingGrocery(undefined);
    setNewGroceryName(name);
    setGroceryModalOpen(true);
    closeCapture();
  };
  const openAddCost = (name = "") => {
    setEditingCost(undefined);
    setNewCostName(name);
    setCostModalOpen(true);
    closeCapture();
  };
  const navigateTo = (href: string) => {
    suppressNextSheetTidy();
    closeCapture();
    router.push(href);
  };

  // One box: what's typed can also go to Rooftap as a quick ask.
  const canAsk = modules.isEnabled("assistant") && isOnline;
  const asking = canAsk && looksLikeQuestion(q);
  const askRooftap = (text: string) => {
    if (text.trim()) navigateTo(`/assistant/new?kind=quick&ask=${encodeURIComponent(text.trim())}`);
  };

  // "Add '{query}' as…" — mirrors home/page.tsx handleAddAs, but if an item with
  // that exact name already exists (case-insensitive), open THAT item's edit
  // modal instead of a blank add-modal, so we never silently duplicate (FLUX-176).
  const handleAddAs = (type: "task" | "grocery" | "cost", name: string) => {
    const norm = name.trim().toLowerCase();
    if (type === "task") {
      const existing = tasks.find((t) => t.title.trim().toLowerCase() === norm);
      if (existing) { setEditingTask(existing); setNewTaskTitle(""); setTaskModalOpen(true); closeCapture(); return; }
      openAddTask(name);
    } else if (type === "grocery") {
      const existing = groceries.find((g) => g.name.trim().toLowerCase() === norm);
      if (existing) { setEditingGrocery(existing); setNewGroceryName(""); setGroceryModalOpen(true); closeCapture(); return; }
      openAddGrocery(name);
    } else {
      const existing = costItemsList.find((c) => c.name.trim().toLowerCase() === norm);
      if (existing) { setEditingCost(existing); setNewCostName(""); setCostModalOpen(true); closeCapture(); return; }
      openAddCost(name);
    }
  };

  // A search hit's full editor (the row's "Edit details", or a plain hit's
  // tap). Each closes the launcher; the editor is mounted at shell level.
  const openTaskEdit = (t: HouseholdTask) => { setEditingTask(t); setNewTaskTitle(""); setTaskModalOpen(true); closeCapture(); };
  const openGroceryEdit = (g: GroceryItem) => { setEditingGrocery(g); setNewGroceryName(""); setGroceryModalOpen(true); closeCapture(); };
  const openCostEdit = (c: CostItem) => { setEditingCost(c); setNewCostName(""); setCostModalOpen(true); closeCapture(); };
  const openSetupEdit = (item: SetupItem) => { setEditingSetup(item); setSetupModalOpen(true); closeCapture(); };

  // Clicking a search hit: open the matching edit modal (tasks/groceries/costs)
  // or navigate to the item's section — same routing as the /home hub.
  // resolveGlobalHitAction is the single source of the nav-vs-modal decision
  // (also consumed by the mobile results view).
  const handleHitClick = (hit: GlobalHit) => {
    const action = resolveGlobalHitAction(hit);
    if (action.kind === "nav") {
      if (action.href) navigateTo(action.href);
      return;
    }
    switch (action.section) {
      case "tasks": {
        const t = tasks.find((x) => x.id === action.id);
        if (t) openTaskEdit(t);
        return;
      }
      case "groceries": {
        const g = groceries.find((x) => x.id === action.id);
        if (g) openGroceryEdit(g);
        return;
      }
      case "costs": {
        const c = costItemsList.find((x) => x.id === action.id);
        if (c) openCostEdit(c);
        return;
      }
    }
  };

  // Launcher tiles, gated by their owning section. Doc/Scan re-enters the existing
  // file-capture flow (zero behavior change); page-heavy flows navigate.
  const launcherActions: LauncherAction[] = [
    { key: "cost", label: "Cost", section: "costs", icon: Wallet, run: () => openAddCost() },
    { key: "doc", label: "Doc / Scan", section: "documents", icon: ScanLine, onlineOnly: true, run: () => setStep("source") },
    { key: "grocery", label: "Grocery", section: "groceries", icon: ShoppingCart, run: () => openAddGrocery() },
    { key: "todo", label: "To-do", section: "household", icon: ListChecks, run: () => openAddTask() },
    { key: "calendar", label: "Calendar event", section: "calendar", icon: CalendarDays, run: () => navigateTo("/calendar?compose=event") },
    { key: "checklist", label: "Viewing checklist", section: "search", icon: ClipboardCheck, run: () => navigateTo("/checklist") },
    { key: "apartment", label: "Apartment listing", section: "search", icon: Building2, onlineOnly: true, run: () => navigateTo("/apartment/new") },
    { key: "recipe", label: "Recipe", section: "recipes", icon: ChefHat, run: () => navigateTo("/recipes/new") },
    { key: "new-checklist", label: "Checklist", section: "checklists", icon: ListTodo, run: () => navigateTo("/checklists/new") },
  ];
  const enabledActions = launcherActions.filter((a) => enabledSectionIds.has(a.section));

  // Add-as chips, gated the same way (only offer types whose section is enabled).
  const addAsChips = [
    { type: "task" as const, label: "To-do", section: "household", icon: ListChecks },
    { type: "grocery" as const, label: "Grocery", section: "groceries", icon: ShoppingCart },
    { type: "cost" as const, label: "Cost", section: "costs", icon: Wallet },
  ].filter((c) => enabledSectionIds.has(c.section));

  const onFilePicked = (f: File | undefined) => {
    if (!f) return;
    const validationError = validateDocumentFile(f);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setFile(f);
    setStep("category");
  };

  // FLUX-117: multiple files → go straight to the multi-file confirm step (filed
  // as documents). A single file falls back to the normal category flow.
  const onFilesPicked = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const all = Array.from(list);
    if (all.length === 1) { onFilePicked(all[0]); return; }

    const valid = all.filter((f) => !validateDocumentFile(f));
    const rejected = all.length - valid.length;
    if (valid.length === 0) {
      setError(`Those files can't be uploaded (images or PDF, max ${DOCUMENT_MAX_LABEL}).`);
      return;
    }
    setError(rejected > 0 ? `${rejected} file(s) skipped (images or PDF, max ${DOCUMENT_MAX_LABEL}).` : null);
    setMultiFiles(valid);
    setRows(valid.map(() => ({
      name: defaultDocName("other"), nameEdited: false, docType: "other" as DocType, expiry: "", tags: [],
    })));
    setStep("multi");
    if (groupId) {
      const supabase = createClient();
      listDocumentTags(supabase, groupId).then(setGroupTags).catch(() => {});
    }
  };

  const updateRow = (i: number, patch: Partial<MultiRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const applyCategoryToAll = (dt: DocType) =>
    setRows((prev) => prev.map((r) => ({
      ...r, docType: dt, name: r.nameEdited ? r.name : defaultDocName(dt),
    })));

  const confirmMulti = async () => {
    if (!groupId || multiFiles.length === 0) return;
    setBusy(true);
    setBusyLabel(`Saving ${multiFiles.length} documents…`);
    setError(null);
    const supabase = createClient();
    let ok = 0;
    const failed: string[] = [];
    for (let i = 0; i < multiFiles.length; i++) {
      const f = multiFiles[i];
      const row = rows[i];
      try {
        const doc = await uploadDocument({
          supabase, groupId, file: f, docType: row.docType, source: "capture",
          title: row.name.trim() || undefined, expiryDate: row.expiry || null, tags: row.tags,
        });
        if (row.expiry) {
          await syncDocumentReminder(supabase, {
            id: doc.id, groupId, name: row.name.trim() || f.name, expiryDate: row.expiry,
          });
        }
        ok++;
      } catch {
        failed.push(f.name);
      }
    }
    if (ok > 0) {
      toast.success(`${ok} document${ok === 1 ? "" : "s"} saved${failed.length ? ` · ${failed.length} failed` : ""}`, {
        action: { label: "View", onClick: () => router.push("/documents") },
      });
      navigateTo("/documents");
    } else {
      setError("None of the documents could be saved. Please try again.");
      setBusy(false);
    }
  };

  // ── Category routing ───────────────────────────────────────────────────────

  const startInvoice = useCallback(async (f: File) => {
    setStep("invoice");
    setParsing(true);
    setError(null);
    // Best-effort parse to prefill; the file is still saved if this fails.
    const p = await parseReceiptFile(f);
    setParsed(p);
    if (p?.retailer) setInvName(p.retailer);
    if (p?.total != null) setInvAmount(String(p.total));
    if (p?.purchase_date) setInvDate(p.purchase_date.slice(0, 10));
    setParsing(false);
    // Load existing cost lines for the "attach to existing" picker.
    if (groupId) {
      const supabase = createClient();
      listCostItems(supabase, groupId).then(setCostItems).catch(() => {});
    }
  }, [groupId]);

  const confirmInvoice = async () => {
    if (!groupId || !file) return;
    setBusy(true);
    setBusyLabel("Saving invoice…");
    setError(null);
    try {
      const supabase = createClient();
      const doc = await uploadDocument({
        supabase,
        groupId,
        file,
        docType: "invoice",
        source: "capture",
        title: invName.trim() || undefined,
        parsed: parsed ?? undefined,
      });

      let costItemId = existingId;
      if (attachMode === "new" || !costItemId) {
        const amountCents = invAmount ? Math.round(parseFloat(invAmount) * 100) : 0;
        const item = await createOneOffCostItem(supabase, groupId, {
          name: invName.trim() || "Invoice",
          amount: Number.isFinite(amountCents) ? amountCents : 0,
          category: "other",
          provider: parsed?.retailer ?? null,
          start_date: invDate || null,
        });
        costItemId = item.id;
      }

      await linkDocument({
        supabase,
        documentId: doc.id,
        groupId,
        entityType: "cost_item",
        entityId: costItemId,
        linkRole: "bill",
      });

      toast.success("Invoice saved to Costs", {
        action: { label: "View", onClick: () => router.push("/costs") },
      });
      navigateTo("/costs");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the invoice.");
      setBusy(false);
    }
  };

  const runGrocery = useCallback(async (f: File) => {
    if (!groupId) return;
    setBusy(true);
    setBusyLabel("Adding to today's shop…");
    setError(null);
    try {
      const supabase = createClient();

      // Replicate the FLUX-95 pipeline. Pull today's grocery items to compute the
      // summed total + feed price-learning (the groceries page re-syncs precisely
      // on next visit, so an approximate summed here is corrected later).
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const { data: itemRows } = await supabase
        .from("grocery_items")
        .select("*")
        .eq("group_id", groupId);
      const items = (itemRows ?? []) as GroceryItem[];
      const summed = items
        .filter((i) => i.status === "bought" && (i.last_purchased_at ?? "").slice(0, 10) === todayKey)
        .reduce((s, i) => s + (i.last_price ?? i.price_cents ?? 0), 0);

      let session = (await fetchTodaySession(supabase, groupId)) ?? (await ensureSession(supabase, groupId, "on", summed));
      if (!session) throw new Error("Could not start today's grocery session.");

      const up = await uploadReceipt(supabase, groupId, session.session_date, f);
      if (!up) throw new Error("Receipt upload failed.");
      session = (await updateSession(supabase, session.id, { receipt_path: up.path, receipt_name: up.name })) ?? session;

      // Best-effort parse + learn (file already saved if this fails).
      const p = await parseReceiptFile(f);
      if (p) {
        const patch: Partial<typeof session> = {};
        if (p.total != null) patch.receipt_total_cents = Math.round(p.total * 100);
        if (p.retailer) patch.retailer = p.retailer;
        if (Object.keys(patch).length) session = (await updateSession(supabase, session.id, patch)) ?? session;
        await applyReceiptLearning(supabase, groupId, p, items);
      }

      // Link the cost line + mirror the receipt onto it (FLUX-95 behavior).
      session = await syncSession(supabase, session, groupId, summed);

      // Register the SAME storage object into the documents store (no re-upload),
      // then link it to the grocery session so it surfaces in /documents.
      // Modules: grocery receipts as documents need documents and groceries (module-features.ts).
      if (isFeatureEnabled("documents.groceries", getEnabledModules())) {
        const docRow = await registerDocument({
          supabase,
          groupId,
          storagePath: up.path,
          filename: up.name,
          docType: "receipt",
          source: "grocery",
          mimeType: f.type || null,
          sizeBytes: f.size,
          parsed: p ?? undefined,
        });
        await linkDocument({
          supabase,
          documentId: docRow.id,
          groupId,
          entityType: "grocery_session",
          entityId: session.id,
          linkRole: "receipt",
        });
      }

      toast.success("Receipt added to today's shop", {
        action: { label: "View", onClick: () => router.push("/groceries") },
      });
      navigateTo("/groceries");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the receipt.");
      setBusy(false);
    }
  }, [groupId, router]); // eslint-disable-line react-hooks/exhaustive-deps

  // Document / Other → open the details step (name, category, metadata) instead
  // of saving blindly. Loads existing tags (autocomplete) + cost items (linking).
  const startDocument = useCallback((cat: Category) => {
    const initialType: DocType = cat === "other" ? "photo" : "other";
    setDocType(initialType);
    setDocNameEdited(false);
    setDocName(defaultDocName(initialType));
    setDocExpiry("");
    setDocTags([]);
    setDocMetadata({});
    setDocLinkCostId("");
    setDocParse(false);
    setDocOcrTitle(null);
    setDocParsedData(null);
    setStep("details");
    if (groupId) {
      const supabase = createClient();
      listDocumentTags(supabase, groupId).then(setGroupTags).catch(() => {});
      if (docCostLinkOn) listCostItems(supabase, groupId).then(setCostItems).catch(() => {});
    }
  }, [groupId, docCostLinkOn]);

  // Parse is intrusive/slow, so it's opt-in for documents. Toggling on runs a
  // best-effort OCR to suggest a title (revisit once a background queue exists).
  const toggleParse = async () => {
    const next = !docParse;
    setDocParse(next);
    if (next && file && docOcrTitle == null) {
      setDocParsing(true);
      const p = await parseReceiptFile(file);
      setDocParsedData(p ?? null);
      setDocOcrTitle(p?.retailer ?? "");
      setDocParsing(false);
    }
  };

  const renameViaPrompt = async (id: string, current: string) => {
    const next = await dialog.prompt({ title: "Rename document", defaultValue: current, confirmLabel: "Rename" });
    if (next && next.trim()) {
      await renameDocument(createClient(), id, next.trim());
      toast.success("Renamed");
    }
  };

  const confirmDocument = async () => {
    if (!groupId || !file) return;
    setBusy(true);
    setBusyLabel("Saving…");
    setError(null);
    try {
      const supabase = createClient();
      const doc = await uploadDocument({
        supabase,
        groupId,
        file,
        docType,
        source: "capture",
        title: docName.trim() || undefined,
        expiryDate: docExpiry || null,
        tags: docTags,
        metadata: docMetadata,
        parsed: docParse ? (docParsedData ?? undefined) : undefined,
      });
      if (docLinkCostId && docCostLinkOn) {
        await linkDocument({
          supabase, documentId: doc.id, groupId,
          entityType: "cost_item", entityId: docLinkCostId, linkRole: "document",
        });
      }
      // Auto-create an expiry reminder when a date was set (FLUX-116).
      if (docExpiry) {
        await syncDocumentReminder(supabase, {
          id: doc.id, groupId, name: docName.trim() || doc.filename, expiryDate: docExpiry,
        });
      }
      const savedId = doc.id;
      const savedName = docName.trim();
      toast.success("Saved to Documents", {
        action: { label: "Rename", onClick: () => void renameViaPrompt(savedId, savedName) },
      });
      navigateTo("/documents");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the document.");
      setBusy(false);
    }
  };

  const onCategory = (cat: Category) => {
    if (!file) return;
    if (cat === "invoice") void startInvoice(file);
    else if (cat === "grocery") void runGrocery(file);
    else startDocument(cat);
  };

  // Keep the default name in sync with category + OCR until the user edits it.
  useEffect(() => {
    if (step === "details" && !docNameEdited) {
      setDocName(defaultDocName(docType, docParse ? docOcrTitle : null));
    }
  }, [step, docType, docParse, docOcrTitle, docNameEdited]);

  const docNameIsWeak = !docNameEdited && !(docParse && docOcrTitle);
  const docFileKind = useMemo(() => {
    if (!file) return "";
    if (file.type === "application/pdf") return "PDF";
    if (file.type.startsWith("image/")) return "Image";
    return file.type || "File";
  }, [file]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="bottom"
        open={open}
        onOpenChange={setOpen}
        className="rounded-t-2xl max-h-[88dvh] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]"
        style={
          keyboardInset > 0
            ? { bottom: keyboardInset, maxHeight: `calc(100dvh - ${keyboardInset}px - 1rem)` }
            : undefined
        }
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {step !== "launcher" && !busy && (
              <button
                onClick={() => setStep(step === "source" ? "launcher" : step === "category" || step === "multi" ? "source" : "category")}
                aria-label="Back"
                className="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            {step === "launcher" ? "Add" : step === "source" ? "Capture" : step === "category" ? "What is this?" : step === "invoice" ? "Invoice details" : step === "multi" ? "Add documents" : "Document details"}
          </SheetTitle>
          <SheetDescription>
            {step === "launcher"
              ? canAsk ? "Add anything, ask Rooftap, or search to jump to it." : "Add anything, or search to jump to it."
              : step === "source"
              ? "Snap a photo or pick a file. We'll file it for you."
              : step === "category"
                ? file?.name
                : step === "invoice"
                  ? "Confirm where this lands in Costs."
                  : step === "multi"
                    ? `${multiFiles.length} files: name and file each.`
                    : "Name it and file it so you can find it later."}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-2">
          {step === "launcher" ? (
            // ── Quick-add launcher (FLUX-174) — opens even offline ──────────────
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    // A question goes to Rooftap on Enter; anything else waits for a pick.
                    if (e.key === "Enter" && asking) {
                      e.preventDefault();
                      askRooftap(q);
                    }
                  }}
                  placeholder={canAsk ? "Add or ask anything" : "Search or add…"}
                  aria-label={canAsk ? "Add or ask anything" : "Search or add"}
                  enterKeyHint={asking ? "send" : undefined}
                  className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:border-ring"
                />
              </div>

              {q.trim() ? (
                <div className="space-y-3">
                  {/* Add-as chips pinned ABOVE results so the keyboard can't hide
                      the primary add actions (FLUX-176 point 2). */}
                  {/* HOUP-443: hand the text to the assistant as a quick ask.
                      When it reads as a question it leads, in the assistant's
                      tile hue, and Enter sends it (one box: add or ask). */}
                  {canAsk && (
                    <button
                      type="button"
                      data-hue={sectionHue("assistant")}
                      onClick={() => askRooftap(q)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition",
                        asking
                          ? "border-transparent bg-[var(--hue-tile)] hover:brightness-110"
                          : "border-border bg-card hover:bg-muted/60"
                      )}
                    >
                      <Sparkles className="h-4 w-4 shrink-0 text-[var(--hue-glyph)]" />
                      <span className="min-w-0 flex-1 truncate">
                        Ask Rooftap <span className="text-muted-foreground">“{q.trim()}”</span>
                      </span>
                      {asking && (
                        <kbd className="hidden shrink-0 rounded-md border border-border px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground md:inline">
                          Enter
                        </kbd>
                      )}
                    </button>
                  )}

                  {addAsChips.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs text-muted-foreground">
                        Add <span className="font-medium text-foreground">“{q.trim()}”</span> as…
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {addAsChips.map((c) => (
                          <button
                            key={c.type}
                            data-hue={sectionHue(c.section)}
                            onClick={() => handleAddAs(c.type, q.trim())}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium transition hover:bg-muted/60"
                          >
                            {/* Hearth v2: the chip's glyph wears its section's hue, as on the tab bar. */}
                            <c.icon className="h-3.5 w-3.5 text-[var(--hue-glyph)]" />
                            {c.label}
                            <Plus className="h-3 w-3 text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* At most 3 results (FLUX-176 point 1) in a bounded scroll region
                      (point 3), each as its section's real line item: a to-do
                      swipes, ticks and holds exactly as on /tasks. */}
                  {groupId && (
                    <CaptureSearchResults
                      index={searchIndex}
                      query={q}
                      docsLoading={docsLoading}
                      groupId={groupId}
                      currentUserId={currentUserId}
                      groupMembers={groupMembers}
                      memberProfiles={memberProfiles}
                      tasks={tasks}
                      groceries={groceries}
                      costItems={costItemsList}
                      setupItems={setupItemsList}
                      recipes={recipesList}
                      shopperWants={shopperList}
                      checklists={checklistsList}
                      setupStores={setupStores}
                      onSetupStoreCreated={(store) => setSetupStores((prev) => [...prev, store])}
                      customAisles={groceryAux.customAisles}
                      libraryPriceFor={groceryAux.priceFor}
                      writeTask={writeTask}
                      patchTask={patchTask}
                      softDeleteTask={softDeleteTask}
                      writeGrocery={writeGrocery}
                      softDeleteGrocery={softDeleteGrocery}
                      patchCost={patchCost}
                      softDeleteCost={softDeleteCost}
                      patchSetup={patchSetup}
                      softDeleteSetup={softDeleteSetup}
                      onEditTask={openTaskEdit}
                      onEditGrocery={openGroceryEdit}
                      onEditCost={openCostEdit}
                      onEditSetup={openSetupEdit}
                      onBeforeNavigate={() => {
                        suppressNextSheetTidy();
                        closeCapture();
                      }}
                      onHitClick={handleHitClick}
                    />
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2.5">
                  {enabledActions.map((a) => {
                    const current = a.key === currentLauncherActionKey;
                    return (
                      <button
                        key={a.key}
                        data-hue={sectionHue(a.section)}
                        onClick={a.run}
                        disabled={a.onlineOnly && !isOnline}
                        aria-current={current ? "page" : undefined}
                        title={
                          current
                            ? "On this page"
                            : a.onlineOnly && !isOnline
                              ? "Needs a connection"
                              : undefined
                        }
                        // Hearth v2: each tile leads with its section's hue tile,
                        // matching the tab bar; the page you're on is ringed in
                        // that same hue (not --primary, which stays interactive).
                        className={cn(
                          "relative flex flex-col items-center justify-center gap-2 rounded-xl border px-2 py-4 text-center transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40",
                          current
                            ? "border-[color:var(--hue-glyph)]/60 bg-card ring-1 ring-[color:var(--hue-glyph)]/30"
                            : "border-border bg-card hover:bg-muted/60"
                        )}
                      >
                        {current && (
                          <span
                            aria-hidden
                            className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--hue-glyph)] text-background shadow-sm"
                          >
                            <Check className="h-2.5 w-2.5" strokeWidth={3} />
                          </span>
                        )}
                        <LeadingTile sectionId={a.section} Icon={a.icon} size="lg" />
                        <span className={cn("text-xs font-medium leading-tight", current && "font-semibold text-[var(--hue-glyph)]")}>{a.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : !isOnline ? (
            <p className="rounded-lg border border-border bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground">
              You&apos;re offline. Capture needs a connection to upload. Try again once you&apos;re back online.
            </p>
          ) : busy ? (
            <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {busyLabel}
            </div>
          ) : step === "source" ? (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-6 text-sm font-medium hover:bg-muted/60 active:scale-[0.99] transition"
              >
                <Camera className="h-6 w-6 text-primary" />
                Take photo
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-6 text-sm font-medium hover:bg-muted/60 active:scale-[0.99] transition"
              >
                <Upload className="h-6 w-6 text-primary" />
                Choose file
              </button>
            </div>
          ) : step === "category" ? (
            <div className="grid gap-2">
              {captureCategories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onCategory(c.id)}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left hover:bg-muted/60 active:scale-[0.99] transition"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                    <c.icon className="h-4.5 w-4.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{c.label}</span>
                    <span className="block text-xs text-muted-foreground truncate">{c.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : step === "invoice" ? (
            // Invoice sub-step
            <div className="space-y-3">
              {parsing && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the invoice…
                </p>
              )}

              <div className="flex rounded-lg border border-border p-0.5 text-sm">
                <button
                  onClick={() => setAttachMode("new")}
                  className={cn("flex-1 rounded-md px-3 py-1.5 font-medium transition", attachMode === "new" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                >
                  New cost
                </button>
                <button
                  onClick={() => setAttachMode("existing")}
                  disabled={costItems.length === 0}
                  className={cn("flex-1 rounded-md px-3 py-1.5 font-medium transition disabled:opacity-40", attachMode === "existing" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                >
                  Existing
                </button>
              </div>

              {attachMode === "new" ? (
                <div className="space-y-2.5">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">Name</span>
                    <input
                      value={invName}
                      onChange={(e) => setInvName(e.target.value)}
                      placeholder="e.g. Origin Energy bill"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-muted-foreground">Amount ($)</span>
                      <input
                        value={invAmount}
                        onChange={(e) => setInvAmount(e.target.value)}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-muted-foreground">Date</span>
                      <input
                        type="date"
                        value={invDate}
                        onChange={(e) => setInvDate(e.target.value)}
                        onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* unsupported */ } }}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Attach to</span>
                  <SearchablePicker
                    options={costItemsToOptions(costItems)}
                    value={existingId || null}
                    onChange={setExistingId}
                    placeholder="Select a cost item…"
                    searchPlaceholder="Search cost items…"
                    emptyText="No cost items yet"
                    recentCount={3}
                    ariaLabel="Attach to cost item"
                  />
                </label>
              )}

              <button
                onClick={() => void confirmInvoice()}
                disabled={attachMode === "existing" && !existingId}
                className="w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition"
              >
                Save invoice
              </button>
            </div>
          ) : step === "multi" ? (
            // Multi-file confirm sub-step (FLUX-117)
            <div className="space-y-3">
              {/* Apply category to all */}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Set all categories</span>
                <SearchablePicker
                  options={DOC_TYPE_PICKER_OPTIONS}
                  value={null}
                  onChange={(v) => applyCategoryToAll(v as DocType)}
                  placeholder="Apply a category to all…"
                  searchPlaceholder="Search categories…"
                  ariaLabel="Apply category to all"
                />
              </label>

              <div className="space-y-2.5">
                {multiFiles.map((f, i) => (
                  <div key={i} className="rounded-lg border border-border p-2.5 space-y-2">
                    <p className="truncate text-[11px] text-muted-foreground">{f.name}</p>
                    <input
                      value={rows[i]?.name ?? ""}
                      onChange={(e) => updateRow(i, { name: e.target.value, nameEdited: true })}
                      placeholder="Name"
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-ring"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <SearchablePicker
                        options={DOC_TYPE_PICKER_OPTIONS}
                        value={rows[i]?.docType ?? "other"}
                        onChange={(v) => updateRow(i, { docType: v as DocType, ...(rows[i]?.nameEdited ? {} : { name: defaultDocName(v as DocType) }) })}
                        placeholder="Category"
                        searchPlaceholder="Search…"
                        ariaLabel={`Category for ${f.name}`}
                      />
                      <input
                        type="date"
                        value={rows[i]?.expiry ?? ""}
                        onChange={(e) => updateRow(i, { expiry: e.target.value })}
                        onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* unsupported */ } }}
                        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-ring"
                      />
                    </div>
                    <TagInput tags={rows[i]?.tags ?? []} onChange={(t) => updateRow(i, { tags: t })} suggestions={groupTags} />
                  </div>
                ))}
              </div>

              <button
                onClick={() => void confirmMulti()}
                className="w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition"
              >
                Save {multiFiles.length} documents
              </button>
            </div>
          ) : (
            // Document details sub-step (FLUX-114)
            <div className="space-y-3">
              {/* Name + inline nudge when it's still the generic default */}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Name</span>
                <input
                  value={docName}
                  onChange={(e) => { setDocName(e.target.value); setDocNameEdited(true); }}
                  placeholder="e.g. Fridge warranty"
                  className={cn(
                    "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition",
                    docNameIsWeak ? "border-warning/70 focus:border-warning" : "border-border focus:border-ring"
                  )}
                />
                {docNameIsWeak && (
                  <span className="mt-1 block text-[11px] text-warning">
                    Give this a clear name so you can find it later.
                  </span>
                )}
              </label>

              {/* Category */}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Category</span>
                <SearchablePicker
                  options={DOC_TYPE_PICKER_OPTIONS}
                  value={docType}
                  onChange={(v) => setDocType(v as DocType)}
                  placeholder="Choose a category…"
                  searchPlaceholder="Search categories…"
                  ariaLabel="Document category"
                />
              </label>

              {/* Per-category sub-fields (FLUX-133) */}
              <MetadataSubForm docType={docType} value={docMetadata} onChange={setDocMetadata} />

              {/* Expiry — emphasised for categories that expire */}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Expiry date {EXPIRY_CATEGORIES.has(docType) ? <span className="text-warning">· recommended</span> : <span className="opacity-60">· optional</span>}
                </span>
                <input
                  type="date"
                  value={docExpiry}
                  onChange={(e) => setDocExpiry(e.target.value)}
                  onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* unsupported */ } }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                />
              </label>

              {/* Tags */}
              <div>
                <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Tag className="h-3 w-3" /> Tags
                </span>
                <TagInput tags={docTags} onChange={setDocTags} suggestions={groupTags} />
              </div>

              {/* Optional cost link */}
              {docCostLinkOn && costItems.length > 0 && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Link to a cost (optional)</span>
                  <SearchablePicker
                    options={costItemsToOptions(costItems)}
                    value={docLinkCostId || null}
                    onChange={setDocLinkCostId}
                    placeholder="Not linked"
                    searchPlaceholder="Search cost items…"
                    emptyText="No cost items"
                    recentCount={3}
                    ariaLabel="Link to cost item"
                  />
                </label>
              )}

              {/* Parse toggle + read-only file meta */}
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="flex items-center gap-2 text-sm">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span>
                    Scan for a title
                    {docParsing && <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin" />}
                    <span className="block text-[11px] text-muted-foreground">Optional OCR (takes a moment)</span>
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={docParse}
                  onClick={() => void toggleParse()}
                  className={cn("relative h-5 w-9 rounded-full transition", docParse ? "bg-primary" : "bg-muted")}
                >
                  <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition", docParse ? "left-[1.125rem]" : "left-0.5")} />
                </button>
              </div>

              <p className="text-[11px] text-muted-foreground">{docFileKind} · added by you</p>

              <button
                onClick={() => void confirmDocument()}
                className="w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition"
              >
                Save document
              </button>
            </div>
          )}

          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        </div>

        {/* Hidden file inputs — camera uses the rear camera on mobile. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept={DOCUMENT_ACCEPT_ATTR}
          capture="environment"
          className="hidden"
          onChange={(e) => { onFilePicked(e.target.files?.[0]); e.target.value = ""; }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept={DOCUMENT_ACCEPT_ATTR}
          multiple
          className="hidden"
          onChange={(e) => { onFilesPicked(e.target.files); e.target.value = ""; }}
        />
      </SheetContent>
    </Sheet>

    {/* Shell-mounted quick-add modals (FLUX-174) — opened from the launcher on
        any page. `key` resets internal form state per new prefill / edited item,
        mirroring home/page.tsx. Writes go through the offline-first Legend store. */}
    {groupId && (
      <>
        <HouseholdTaskModal
          key={editingTask?.id ?? `new-task-${newTaskTitle}`}
          isOpen={taskModalOpen}
          task={editingTask}
          groupId={groupId}
          defaultTitle={newTaskTitle || undefined}
          onClose={() => { setTaskModalOpen(false); setEditingTask(undefined); setNewTaskTitle(""); }}
          onSave={(task) => { const isNew = !editingTask; writeTask(task); setTaskModalOpen(false); setEditingTask(undefined); setNewTaskTitle(""); bumpBadge(); if (isNew) toastItemAdded(task.title, () => { setEditingTask(task); setTaskModalOpen(true); }); }}
          onDelete={(taskId) => { softDeleteTask(taskId); setTaskModalOpen(false); setEditingTask(undefined); setNewTaskTitle(""); bumpBadge(); }}
        />
        <GroceryItemModal
          key={editingGrocery?.id ?? `new-grocery-${newGroceryName}`}
          isOpen={groceryModalOpen}
          item={editingGrocery}
          groupId={groupId}
          defaultName={newGroceryName || undefined}
          onClose={() => { setGroceryModalOpen(false); setEditingGrocery(undefined); setNewGroceryName(""); }}
          onSave={(item) => { const isNew = !editingGrocery; writeGrocery(item); setGroceryModalOpen(false); setEditingGrocery(undefined); setNewGroceryName(""); if (isNew) toastItemAdded(item.name, () => { setEditingGrocery(item); setGroceryModalOpen(true); }); }}
        />
        <SetupItemModal
          key={editingSetup?.id ?? "new-setup"}
          isOpen={setupModalOpen}
          item={editingSetup}
          groupId={groupId}
          existingRooms={setupRooms}
          stores={setupStores}
          onStoreCreated={(store) => setSetupStores((prev) => [...prev, store])}
          onClose={() => { setSetupModalOpen(false); setEditingSetup(undefined); }}
          onSave={(item) => { writeSetup(item); setSetupModalOpen(false); setEditingSetup(undefined); }}
          onDelete={(itemId) => { softDeleteSetup(itemId); setSetupModalOpen(false); setEditingSetup(undefined); }}
        />
        <CostModal
          key={editingCost?.id ?? `new-cost-${newCostName}`}
          isOpen={costModalOpen}
          item={editingCost}
          groupId={groupId}
          defaultName={newCostName || undefined}
          onClose={() => { setCostModalOpen(false); setEditingCost(undefined); setNewCostName(""); }}
          onSave={(item) => { const isNew = !editingCost; writeCost(item); setCostModalOpen(false); setEditingCost(undefined); setNewCostName(""); if (isNew) toastItemAdded(item.name, () => { setEditingCost(item); setCostModalOpen(true); }); }}
        />
      </>
    )}
    </>
  );
}
