// FLUX-156: Checklists section — shared constants, starter templates, pure row
// builders, and cross-section business rules.
//
// This module is the CONTRACT the /checklists pages and the dashboard/tasks/costs
// integrations all share. It is intentionally side-effect-free: it builds row
// objects and computes rules, but never writes to a store itself. Orchestration
// (calling writeRow/patchRow/softDeleteRow from useStoreHelpers) stays in the
// pages/components where those hooks live. Keeping the shapes + rules here means
// every surface agrees on them without re-deriving.
//
// Write-path note: builders mirror the proven grocery pattern — an explicit
// env randomUUID() id and real `now` ISO timestamps. useStoreHelpers.writeRow
// strips server timestamps on the write path and lets the DB handle_times()
// trigger fill them, classifying the row as an INSERT.

import { envRandomUUID } from './data/store-environment';
import type {
  Checklist,
  ChecklistRenewalMode,
  ChecklistTaskItem,
  ChecklistTemplate,
  ChecklistTemplateItem,
  ChecklistType,
  CostItem,
  HouseholdTask,
} from './types';

// ── Type metadata ────────────────────────────────────────────────────────────
export const CHECKLIST_TYPES: ChecklistType[] = ['plain', 'repeating', 'shopping'];

export interface ChecklistTypeMeta {
  type: ChecklistType;
  emoji: string;
  label: string;
  description: string;
}

export const CHECKLIST_TYPE_META: Record<ChecklistType, ChecklistTypeMeta> = {
  plain: {
    type: 'plain',
    emoji: '☑',
    label: 'Plain',
    description: 'A standalone checklist. Add a date to show it on your dashboard.',
  },
  repeating: {
    type: 'repeating',
    emoji: '🔁',
    label: 'Repeating',
    description: 'Renews on a cadence. Clone a fresh copy or reset it in place each cycle.',
  },
  shopping: {
    type: 'shopping',
    emoji: '🛒',
    label: 'Shopping',
    description: 'Items carry a cost; checking one can log a purchase into Costs.',
  },
};

export function typeMeta(type: ChecklistType): ChecklistTypeMeta {
  return CHECKLIST_TYPE_META[type] ?? CHECKLIST_TYPE_META.plain;
}

/**
 * A type's one-line description without promises the household's modules
 * can't keep. Modules: a date putting the list on the dashboard needs Tasks
 * and Checklists (`tasks.checklists`); logging a purchase needs Costs and
 * Checklists (`costs.from-checklists`) (module-features.ts). The caller passes
 * both from `useModules().feature(...)`.
 */
export function typeDescription(
  type: ChecklistType,
  features: { linkedTask: boolean; logCosts: boolean },
): string {
  const meta = typeMeta(type);
  if (meta.type === 'plain' && !features.linkedTask) return 'A standalone checklist.';
  if (meta.type === 'shopping' && !features.logCosts) return 'Items carry a cost.';
  return meta.description;
}

export const RENEWAL_MODES: ChecklistRenewalMode[] = ['clone', 'reset'];

// ── Starter templates (seeded rows, idempotent by template_key) ─────────────────
// Shipped as editable seeded rows the first time the templates surface loads for a
// group — NOT a hardcoded runtime catalog. seedStarterTemplates() below writes any
// missing ones; users can then edit/delete them like any user-authored template.

export interface StarterTemplateItem {
  label: string;
  default_cost_cents?: number | null;
}

export interface StarterTemplate {
  /** Stable well-known key — used for idempotent seeding. */
  key: string;
  title: string;
  default_type: ChecklistType;
  default_cadence_days?: number | null;
  items: StarterTemplateItem[];
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: 'new_house_purchase',
    title: 'New House Purchase',
    default_type: 'plain',
    items: [
      { label: 'Arrange building & pest inspection' },
      { label: 'Review contract of sale with conveyancer' },
      { label: 'Confirm finance / loan approval' },
      { label: 'Organise deposit transfer' },
      { label: 'Book final walk-through' },
      { label: 'Arrange home & contents insurance' },
      { label: 'Confirm settlement date' },
      { label: 'Set up utilities at new address' },
    ],
  },
  {
    key: 'pre_flight',
    title: 'Pre-Flight',
    default_type: 'plain',
    items: [
      { label: 'Check-in online' },
      { label: 'Passports (all travellers)' },
      { label: 'Boarding passes saved offline' },
      { label: 'Chargers & power adapters' },
      { label: 'Confirm airport transfer' },
      { label: 'Weigh bags' },
      { label: 'Travel insurance documents' },
    ],
  },
  {
    key: 'grocery_run',
    title: 'Grocery run',
    default_type: 'shopping',
    items: [
      { label: 'Milk', default_cost_cents: 300 },
      { label: 'Eggs', default_cost_cents: 550 },
      { label: 'Bread', default_cost_cents: 400 },
      { label: 'Vegetables', default_cost_cents: 1200 },
      { label: 'Chicken', default_cost_cents: 1500 },
    ],
  },
  {
    key: 'weekly_reset',
    title: 'Weekly reset',
    default_type: 'repeating',
    default_cadence_days: 7,
    items: [
      { label: 'Change bed sheets' },
      { label: 'Empty all bins' },
      { label: 'Water the plants' },
      { label: 'Meal plan for the week' },
      { label: 'Tidy shared spaces' },
    ],
  },
  {
    key: 'vacation_packing',
    title: 'Vacation Packing',
    default_type: 'plain',
    items: [
      { label: 'Clothes for the trip' },
      { label: 'Toiletries' },
      { label: 'Medications' },
      { label: 'Chargers & electronics' },
      { label: 'Sunscreen' },
      { label: 'Swimwear' },
    ],
  },
  {
    key: 'visa_finalization',
    title: 'Visa Finalization',
    default_type: 'plain',
    items: [
      { label: 'Complete application form' },
      { label: 'Gather supporting documents' },
      { label: 'Pay application fee' },
      { label: 'Book biometrics appointment' },
      { label: 'Submit application' },
      { label: 'Track application status' },
    ],
  },
];

// ── Seeding & instantiation ──────────────────────────────────────────────────────

/**
 * Write any missing starter templates as seeded rows (idempotent by template_key).
 * Called on first load of a templates-consuming surface. Takes the write helpers
 * so it stays side-effect-free itself (the caller owns the store).
 */
export function seedStarterTemplates(opts: {
  existing: ChecklistTemplate[];
  groupId: string;
  createdBy?: string | null;
  writeTemplate: (t: ChecklistTemplate) => void;
  writeTemplateItem: (i: ChecklistTemplateItem) => void;
}): void {
  const existingKeys = new Set(
    opts.existing.map((t) => t.template_key).filter((k): k is string => !!k),
  );
  for (const starter of STARTER_TEMPLATES) {
    if (existingKeys.has(starter.key)) continue;
    // Deterministic id keyed by (group, template_key): if two clients seed the
    // same starter concurrently/offline, both mint the SAME id and upsert-on-id
    // merges them into one row instead of duplicating.
    const tpl = buildTemplate({
      id: deterministicId(`checklist_template:${opts.groupId}:${starter.key}`),
      groupId: opts.groupId,
      title: starter.title,
      defaultType: starter.default_type,
      defaultCadenceDays: starter.default_cadence_days ?? null,
      templateKey: starter.key,
      createdBy: opts.createdBy ?? null,
    });
    opts.writeTemplate(tpl);
    starter.items.forEach((it, idx) =>
      opts.writeTemplateItem(
        buildTemplateItem({
          id: deterministicId(`checklist_template_item:${opts.groupId}:${starter.key}:${idx}`),
          templateId: tpl.id,
          groupId: opts.groupId,
          label: it.label,
          order: idx,
          defaultCostCents: it.default_cost_cents ?? null,
        }),
      ),
    );
  }
}

/**
 * Instantiate a template into a fresh checklist + item rows (applying the
 * template's default_type/default_cadence_days and per-item default costs).
 * Returns rows ready to writeRow; the caller writes them and, for a dated list,
 * links a dashboard to-do.
 */
export function instantiateTemplate(opts: {
  template: ChecklistTemplate;
  items: ChecklistTemplateItem[];
  scheduledDate?: string | null;
  createdBy?: string | null;
}): { checklist: Checklist; items: ChecklistTaskItem[] } {
  const checklist = buildChecklist({
    groupId: opts.template.group_id,
    title: opts.template.title,
    type: opts.template.default_type ?? 'plain',
    templateKey: opts.template.template_key,
    scheduledDate: opts.scheduledDate ?? null,
    repeatCadenceDays: opts.template.default_cadence_days ?? null,
    createdBy: opts.createdBy ?? null,
  });
  const items = liveItems(opts.items)
    .sort((a, b) => a.order - b.order)
    .map((it, idx) =>
      buildChecklistItem({
        checklistId: checklist.id,
        groupId: checklist.group_id,
        label: it.label,
        order: idx,
        costCents: it.default_cost_cents,
      }),
    );
  return { checklist, items };
}

// ── currency helpers (dollars ↔ cents for cost-bearing fields) ──────────────────
export function dollarsToCents(dollars: string): number | null {
  const trimmed = dollars.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}

// ── id / time helpers ──────────────────────────────────────────────────────────
export function freshId(): string {
  return envRandomUUID();
}
function nowISO(): string {
  return new Date().toISOString();
}

// cyrb128: a fast, synchronous 128-bit string hash (public domain).
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k: number; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * A deterministic, valid UUID derived from a stable seed. Same seed → same id,
 * so concurrent/offline idempotent writes (starter-template seeding, repeating
 * clone-mode renewal) collide on the primary key and the store's upsert-on-id
 * `create()` merges them into ONE row instead of creating duplicates — without
 * needing a DB unique constraint (which would risk a sync-retry stall).
 */
export function deterministicId(seed: string): string {
  const [a, b, c, d] = cyrb128(seed);
  const hex =
    a.toString(16).padStart(8, '0') +
    b.toString(16).padStart(8, '0') +
    c.toString(16).padStart(8, '0') +
    d.toString(16).padStart(8, '0');
  // Splice in the version (5) + RFC-4122 variant nibbles so it's a valid UUID.
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-` +
    `${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

// ── Pure row builders ────────────────────────────────────────────────────────────
// Each returns a fully-formed row ready to hand to useStoreHelpers.writeRow.

export function buildChecklist(input: {
  groupId: string;
  title: string;
  type?: ChecklistType;
  templateKey?: string | null;
  sourceChecklistId?: string | null;
  scheduledDate?: string | null;
  logCosts?: boolean;
  repeatCadenceDays?: number | null;
  repeatRenewalMode?: ChecklistRenewalMode | null;
  createdBy?: string | null;
  /** Override the generated id (deterministic seeding / idempotent renewal). */
  id?: string;
}): Checklist {
  const now = nowISO();
  const type = input.type ?? 'plain';
  return {
    id: input.id ?? freshId(),
    group_id: input.groupId,
    title: input.title.trim(),
    type,
    template_key: input.templateKey ?? null,
    source_checklist_id: input.sourceChecklistId ?? null,
    completed_at: null,
    scheduled_date: input.scheduledDate ?? null,
    linked_task_id: null,
    log_costs: input.logCosts ?? type === 'shopping',
    repeat_cadence_days: input.repeatCadenceDays ?? (type === 'repeating' ? 7 : null),
    repeat_renewal_mode: input.repeatRenewalMode ?? (type === 'repeating' ? 'clone' : null),
    created_by: input.createdBy ?? null,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

export function buildChecklistItem(input: {
  checklistId: string;
  groupId: string;
  label: string;
  order: number;
  costCents?: number | null;
  /** Override the generated id (deterministic seeding / idempotent renewal). */
  id?: string;
}): ChecklistTaskItem {
  const now = nowISO();
  return {
    id: input.id ?? freshId(),
    checklist_id: input.checklistId,
    group_id: input.groupId,
    label: input.label.trim(),
    is_done: false,
    checked_by: null,
    checked_at: null,
    cost_cents: input.costCents ?? null,
    linked_cost_item_id: null,
    order: input.order,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

export function buildTemplate(input: {
  groupId: string;
  title: string;
  defaultType?: ChecklistType | null;
  defaultCadenceDays?: number | null;
  templateKey?: string | null;
  createdBy?: string | null;
  /** Override the generated id (deterministic seeding). */
  id?: string;
}): ChecklistTemplate {
  const now = nowISO();
  return {
    id: input.id ?? freshId(),
    group_id: input.groupId,
    title: input.title.trim(),
    default_type: input.defaultType ?? null,
    default_cadence_days: input.defaultCadenceDays ?? null,
    template_key: input.templateKey ?? null,
    created_by: input.createdBy ?? null,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

export function buildTemplateItem(input: {
  templateId: string;
  groupId: string;
  label: string;
  order: number;
  defaultCostCents?: number | null;
  /** Override the generated id (deterministic seeding). */
  id?: string;
}): ChecklistTemplateItem {
  const now = nowISO();
  return {
    id: input.id ?? freshId(),
    template_id: input.templateId,
    group_id: input.groupId,
    label: input.label.trim(),
    default_cost_cents: input.defaultCostCents ?? null,
    order: input.order,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

/**
 * Build the linked household_tasks row for a dated checklist. Carries
 * linked_checklist_id so the dashboard can deep-link back and show completion.
 * The /home hub's buildHeroItems converger already surfaces due-today tasks.
 */
export function buildLinkedTask(input: {
  checklist: Checklist;
  createdBy?: string | null;
  /** Override the generated id (idempotent renewal). */
  id?: string;
}): HouseholdTask {
  const now = nowISO();
  return {
    id: input.id ?? freshId(),
    group_id: input.checklist.group_id,
    title: input.checklist.title,
    due_date: input.checklist.scheduled_date,
    due_time: null,
    offset_days: null,
    recurrence_days: null,
    done: false,
    completed_at: null,
    assigned_to: null,
    private: false,
    template_key: null,
    notes: null,
    sort_order: 0,
    linked_checklist_id: input.checklist.id,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

/**
 * HOUP-332: build a fresh checklist LINKED FROM a task that already exists —
 * the reverse direction of `buildLinkedTask` (which links a task from a
 * checklist). Returns both the new checklist row (carrying `linked_task_id`)
 * and the task-side patch (`linked_checklist_id`) from one function so the two
 * writes can never fork between callers. Does NOT call `buildLinkedTask` — the
 * task already exists — and writes no completion field on either side.
 */
export function linkNewChecklistToTask(input: {
  task: HouseholdTask;
  createdBy?: string | null;
}): { checklist: Checklist; taskPatch: Partial<HouseholdTask> } {
  const checklist = buildChecklist({
    groupId: input.task.group_id,
    title: input.task.title,
    type: 'plain',
    scheduledDate: input.task.due_date,
    createdBy: input.createdBy ?? null,
  });
  checklist.linked_task_id = input.task.id;
  return { checklist, taskPatch: { linked_checklist_id: checklist.id } };
}

/**
 * Build the cost_items row logged when a Shopping item is checked. Reuses the
 * existing linked_section convention — NO cost-table schema change. amount is in
 * cents (matches CostItem.amount minor units).
 */
export function buildLoggedCost(input: {
  item: ChecklistTaskItem;
  checklist: Checklist;
  createdBy?: string | null;
}): CostItem {
  const now = nowISO();
  return {
    id: freshId(),
    group_id: input.checklist.group_id,
    name: input.item.label,
    category: 'purchase',
    amount: input.item.cost_cents ?? 0,
    cadence: 'one_off',
    is_estimate: false,
    start_date: null,
    end_date: null,
    discount_end_date: null,
    provider: null,
    assigned_to: null,
    linked_section: 'checklists',
    notes: null,
    sort_order: 0,
    created_by: input.createdBy ?? null,
    created_at: now,
    updated_at: now,
    deleted: false,
  };
}

// ── Item-check patch builders ────────────────────────────────────────────────────
// Return the Partial<ChecklistTaskItem> patch for check / uncheck, stamping
// attribution. Cost/linked-cost fields are patched separately by the caller once
// it has written/soft-deleted the cost row (so the reverse pointer is accurate).

export function checkItemPatch(userId: string | null | undefined): Partial<ChecklistTaskItem> {
  return { is_done: true, checked_by: userId ?? null, checked_at: nowISO() };
}

export function uncheckItemPatch(): Partial<ChecklistTaskItem> {
  return { is_done: false, checked_by: null, checked_at: null };
}

// ── Edit-in-place patch builders (HOUP-328) ──────────────────────────────────────
// Rename/re-price never touch is_done, checked_by, checked_at, order or
// linked_cost_item_id — an edit must never look like a check/uncheck event or
// perturb manual order. Empty-on-submit is a revert, not a delete, so these all
// return `null` for an empty trim rather than a patch — callers skip the patch().

export function renameItemPatch(label: string): Partial<ChecklistTaskItem> | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  return { label: trimmed };
}

export function setItemCostPatch(dollars: string): Partial<ChecklistTaskItem> {
  return { cost_cents: dollarsToCents(dollars) };
}

export function renameChecklistPatch(title: string): Partial<Checklist> | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  return { title: trimmed };
}

// ── Completion rules ─────────────────────────────────────────────────────────────
export interface Completion {
  done: number;
  total: number;
  complete: boolean;
}

/** Live rows only (excludes soft-deleted). Generic over any tombstoned row. */
export function liveItems<T extends { deleted: boolean }>(items: T[]): T[] {
  return items.filter((i) => !i.deleted);
}

export function completion(items: ChecklistTaskItem[]): Completion {
  const live = liveItems(items);
  const done = live.filter((i) => i.is_done).length;
  const total = live.length;
  return { done, total, complete: total > 0 && done === total };
}

/** "2/6" style label, matching the row chips' "Checklist 2/6". */
export function completionLabel(items: ChecklistTaskItem[]): string {
  const { done, total } = completion(items);
  return `${done}/${total}`;
}

/** The inline panels' tick toast, coalesced over quick ticks: "Item checked", "3 items checked". */
export function checkedToastLabel(count: number): string {
  return count === 1 ? 'Item checked' : `${count} items checked`;
}

// ── Spend totals (shopping-type lists) ───────────────────────────────────────────
export interface SpendTotals {
  /** Sum of cost_cents over live, done items. */
  spentCents: number;
  /** Sum of cost_cents over all live items. */
  totalCents: number;
}

/**
 * HOUP-330: running total for a shopping-type checklist's lede
 * (`$14.90 of $52.10`). Live rows only; a missing price counts as 0.
 * Callers hide the fragment when `totalCents` is 0 — no item is priced, so
 * there is nothing to total.
 */
export function spendTotals(items: ChecklistTaskItem[]): SpendTotals {
  let spentCents = 0;
  let totalCents = 0;
  for (const it of liveItems(items)) {
    const cents = it.cost_cents ?? 0;
    totalCents += cents;
    if (it.is_done) spentCents += cents;
  }
  return { spentCents, totalCents };
}

// ── Recurrence / renewal ──────────────────────────────────────────────────────────

/**
 * A repeating checklist is due to renew when its cadence date has arrived.
 * The cadence date is tracked via scheduled_date (rolled forward on each renew).
 * Undated repeating lists never auto-renew (nothing to compare against).
 */
export function isRepeatingDue(checklist: Checklist, today: string): boolean {
  if (checklist.type !== 'repeating') return false;
  if (!checklist.repeat_cadence_days || checklist.repeat_cadence_days <= 0) return false;
  if (!checklist.scheduled_date) return false;
  return checklist.scheduled_date <= today;
}

/** Add N days to a YYYY-MM-DD date, returning YYYY-MM-DD (UTC-safe). */
export function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Clone a checklist run into a fresh, unchecked copy (used by manual "Start again"
 * and by Repeating clone-mode renewal). Returns the new checklist + item rows
 * ready to writeRow; the caller archives the source (set completed_at) separately.
 * scheduledDate/linkedTask are intentionally NOT copied — the caller re-links a
 * fresh dashboard to-do for the new run's date if needed.
 */
export function cloneRun(input: {
  source: Checklist;
  items: ChecklistTaskItem[];
  scheduledDate?: string | null;
  createdBy?: string | null;
  /** When set, the new run + its items get deterministic ids derived from this
   *  seed, so concurrent renewals for the SAME cycle upsert to one run instead
   *  of duplicating. Omit for a manual "Start again" (always a fresh run). */
  idSeed?: string | null;
}): { checklist: Checklist; items: ChecklistTaskItem[] } {
  const checklist = buildChecklist({
    id: input.idSeed ? deterministicId(`checklist:${input.idSeed}`) : undefined,
    groupId: input.source.group_id,
    title: input.source.title,
    type: input.source.type,
    templateKey: input.source.template_key,
    sourceChecklistId: input.source.id,
    scheduledDate: input.scheduledDate ?? null,
    logCosts: input.source.log_costs,
    repeatCadenceDays: input.source.repeat_cadence_days,
    repeatRenewalMode: input.source.repeat_renewal_mode,
    createdBy: input.createdBy ?? null,
  });
  const items = liveItems(input.items)
    .sort((a, b) => a.order - b.order)
    .map((it, idx) =>
      buildChecklistItem({
        id: input.idSeed ? deterministicId(`item:${input.idSeed}:${idx}`) : undefined,
        checklistId: checklist.id,
        groupId: checklist.group_id,
        label: it.label,
        order: idx,
        costCents: it.cost_cents,
      }),
    );
  return { checklist, items };
}

// ── Fast item entry (HOUP-329) ───────────────────────────────────────────────────
// Shared by the web + native detail screens' add well so multi-line paste,
// duplicate detection and batch sequencing never fork between platforms.

/** Leading list markers a pasted line may carry: `-`, `*`, `•`, `1.`, `1)`, `- [ ]`, `- [x]`. */
const LIST_MARKER_RE = /^\s*(?:[-*•–—]|\d+[.)])?\s*(?:\[[ xX]\]\s*)?/;

/**
 * Split pasted text into one label per non-empty line. Strips leading list
 * markers / checkbox syntax and trims each line, so a to-do list copied from a
 * message or a markdown note lands as clean labels.
 */
export function splitPastedItems(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(LIST_MARKER_RE, '').trim())
    .filter((line) => line.length > 0);
}

/**
 * The single caret/paste-merge seam behind both screens' paste handling. Merges
 * `pasted` into `current` at the caret (or appends, if no selection is given —
 * RN's `onChangeText` already hands over the merged value, so mobile passes
 * `current: ''`) and splits the result via {@link splitPastedItems}. Returns
 * `[]` when the paste yields no usable label (e.g. blank lines or bare
 * markers); callers treat that as a no-op rather than inventing their own
 * fallback, so the two screens can never diverge on this edge case again.
 */
export function splitPastedIntoField(input: {
  current: string;
  pasted: string;
  selectionStart?: number;
  selectionEnd?: number;
}): string[] {
  const { current, pasted } = input;
  const start = input.selectionStart ?? current.length;
  const end = input.selectionEnd ?? start;
  return splitPastedItems(current.slice(0, start) + pasted + current.slice(end));
}

/** Case- and whitespace-insensitive key for duplicate detection. */
export function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * The live (non-deleted) item whose label matches `label` ignoring case and
 * whitespace, or null. Checked-off items count — they are still on the list.
 */
export function findDuplicateLabel(
  items: ChecklistTaskItem[],
  label: string,
): ChecklistTaskItem | null {
  const key = normalizeLabel(label);
  if (!key) return null;
  return liveItems(items).find((i) => normalizeLabel(i.label) === key) ?? null;
}

/**
 * Build N item rows appended after the current tail of `existing` — the single
 * sequencing seam for both the typed add and a multi-line paste. Orders are
 * `maxOrder + 1 + idx` so a batch lands in paste order after everything else.
 * `costCents` only applies when exactly one label is given (a paste leaves
 * costs untouched — there is no per-line cost to attach).
 */
export function buildAppendedItems(input: {
  checklistId: string;
  groupId: string;
  labels: string[];
  existing: ChecklistTaskItem[];
  costCents?: number | null;
}): ChecklistTaskItem[] {
  const labels = input.labels.map((l) => l.trim()).filter((l) => l.length > 0);
  const maxOrder = liveItems(input.existing).reduce((m, i) => Math.max(m, i.order), -1);
  const cost = labels.length === 1 ? (input.costCents ?? null) : null;
  return labels.map((label, idx) =>
    buildChecklistItem({
      checklistId: input.checklistId,
      groupId: input.groupId,
      label,
      order: maxOrder + 1 + idx,
      costCents: cost,
    }),
  );
}
