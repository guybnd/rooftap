"use client";

// Web twin of packages/ui's ItemSheet (Hearth §7 E1-E4, the "quick line that
// grows"): a tinted title band, then either the quick line (adding: title and
// a few chips, More grows it) or the list of PropertyRows that open in place.
// Adding ends on Add or Return. Editing has no Save: every close path (Done,
// Esc, backdrop, drag, back) hands the caller `onSubmit`, which writes the
// changes.
//
// Under 1024px wide it is a bottom sheet that floats over the keyboard. At
// 1024px and wider it docks as a panel on the right, so the board behind stays
// in view. Keys: Return adds, Tab walks the rows, Space or Return opens one,
// Esc closes.

import * as React from "react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { ArrowUp, Check, ChevronRight, CircleAlert, Ellipsis, X, type LucideIcon } from "lucide-react";
import {
  dialog,
  dueQuickChoices,
  TIME_QUICK_CHOICES,
  timeChoiceLabel,
  todayISO,
  toISODate,
  weekStrip,
  weekStripMonth,
  weekStripOffsetFor,
} from "@homeup/core";

import { cn } from "@/lib/utils";
import { commit, tick, warn } from "@/lib/haptics";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { LeadingTile } from "@/components/ui/leading-tile";
import { ListGroup, ListItem, ListItemBody, ListItemContent, ListItemLeading, ListItemTrailing } from "@/components/ui/list-item";
import { MonthDatePicker } from "@/components/month-date-picker";
import { TimeScrollField } from "@/components/time-scroll-field";

type SectionIcon = React.ComponentType<{ className?: string; strokeWidth?: number }>;

/** A chip on the quick line. Its editor opens in the tray under the line. */
export interface ItemSheetQuickField {
  id: string;
  label: string;
  icon?: React.ReactNode;
  set?: boolean;
  trayLabel: string;
  editor: React.ReactNode;
}

/**
 * Words in the title that mean a field ("tomorrow" means Due). Pending: still
 * being typed, a click sets it now. Set: the words left the title, a click
 * puts them back.
 */
export interface ItemSheetTitleMatch {
  id: string;
  label: string;
  icon?: React.ReactNode;
  pending?: boolean;
  onPress: () => void;
}

export interface ItemSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "edit";
  section?: { id: string; Icon: SectionIcon };
  glyph?: React.ReactNode;
  heading: string;
  caption?: string;
  title: string;
  onTitleChange: (title: string) => void;
  titlePlaceholder: string;
  titleError?: string | null;
  nudge?: number;
  bandExtra?: React.ReactNode;
  titleMatches?: ItemSheetTitleMatch[];
  quickFields?: ItemSheetQuickField[];
  children: React.ReactNode;
  onSubmit: () => void;
  submitLabel?: string;
  onDelete?: () => void;
  deleteLabel?: string;
  deleteConfirmTitle?: string;
  deleteConfirmMessage?: string;
}

const TrayContext = React.createContext<{ close: () => void } | null>(null);

export function ItemSheet({
  open,
  onOpenChange,
  mode,
  section,
  glyph,
  heading,
  caption,
  title,
  onTitleChange,
  titlePlaceholder,
  titleError,
  nudge = 0,
  bandExtra,
  titleMatches,
  quickFields,
  children,
  onSubmit,
  submitLabel = "Add",
  onDelete,
  deleteLabel = "Delete",
  deleteConfirmTitle,
  deleteConfirmMessage,
}: ItemSheetProps) {
  const editing = mode === "edit";
  const hasQuick = !editing && !!quickFields && quickFields.length > 0;
  const [expanded, setExpanded] = React.useState(!hasQuick);
  const [tray, setTray] = React.useState<string | null>(null);
  const [shaking, setShaking] = React.useState(false);
  const titleRef = React.useRef<HTMLInputElement>(null);
  const keyboardInset = useKeyboardInset(open);

  // A new open starts on the quick line again.
  const wasOpen = React.useRef(open);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setExpanded(!hasQuick);
      setTray(null);
    }
    wasOpen.current = open;
  }, [open, hasQuick]);

  // A failed add nudges the band and fires warn().
  const lastNudge = React.useRef(nudge);
  React.useEffect(() => {
    if (nudge === lastNudge.current) return;
    lastNudge.current = nudge;
    warn();
    setShaking(true);
    const t = setTimeout(() => setShaking(false), 260);
    titleRef.current?.focus();
    return () => clearTimeout(t);
  }, [nudge]);

  const requestClose = () => {
    if (editing) onSubmit();
    else onOpenChange(false);
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!editing) commit();
    onSubmit();
  };

  const trayContext = React.useMemo(
    () => ({
      close: () => {
        setTray(null);
        titleRef.current?.focus();
      },
    }),
    []
  );

  const openTray = (id: string) => {
    tick();
    if (tray === id) {
      trayContext.close();
      return;
    }
    // On a phone, leaving the title puts the keyboard away for the tray.
    titleRef.current?.blur();
    setTray(id);
  };

  // More keeps you typing: the list grows and focus goes back to the title.
  const grow = () => {
    tick();
    setTray(null);
    setExpanded(true);
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  const requestDelete = async () => {
    if (!onDelete) return;
    const ok = await dialog.confirm({
      title: deleteConfirmTitle ?? `${deleteLabel}?`,
      message: deleteConfirmMessage ?? "This cannot be undone.",
      confirmLabel: deleteLabel,
      destructive: true,
    });
    if (ok) onDelete();
  };

  const trayField = tray ? quickFields?.find((f) => f.id === tray) : undefined;

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
      overlayClassName="bg-black/40 duration-200 lg:bg-black/10 lg:backdrop-blur-none"
      className={cn(
        "flex-col overflow-hidden bg-popover text-popover-foreground shadow-xl",
        "max-h-[92dvh] rounded-t-3xl border-t border-border",
        // Desktop: a panel docked on the right, the board stays in view.
        "lg:inset-x-auto lg:top-4 lg:right-4 lg:bottom-4 lg:max-h-none lg:w-[400px] lg:rounded-3xl lg:border",
        expanded && "lg:h-auto"
      )}
      style={keyboardInset > 0 ? { bottom: keyboardInset, maxHeight: `calc(100dvh - ${keyboardInset}px - 1rem)` } : undefined}
      handleClassName="px-0 pt-2.5 pb-1 mb-0 bg-muted/50 lg:hidden"
      popupProps={{ "data-slot": "item-sheet" }}
    >
      {(contentRef) => (
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          {/* The band: what the item is, and where you type its name. */}
          <div
            className={cn(
              "shrink-0 border-b bg-muted/50 lg:pt-2",
              titleError ? "border-destructive" : "border-border",
              shaking && "motion-safe:animate-[item-sheet-nudge_240ms_ease-out]"
            )}
          >
            <div className="flex items-center gap-3 px-4 pb-1.5 pt-1">
              {glyph ?? (section ? <LeadingTile sectionId={section.id} Icon={section.Icon} size="md" /> : null)}
              <div className="min-w-0 flex-1">
                <SheetPrimitive.Title className="truncate text-sm font-semibold text-foreground">{heading}</SheetPrimitive.Title>
                {caption && <p className="truncate text-xs text-muted-foreground tabular-nums">{caption}</p>}
              </div>
              {editing ? (
                <Button type="button" variant="ghost" size="lg" onClick={requestClose}>
                  Done
                </Button>
              ) : (
                <Button type="button" variant="ghost" size="icon-lg" aria-label="Close" onClick={requestClose}>
                  <X />
                </Button>
              )}
            </div>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder={titlePlaceholder}
              aria-label={heading}
              aria-invalid={!!titleError}
              aria-describedby={titleError ? "item-sheet-title-error" : undefined}
              autoFocus={!editing}
              enterKeyHint={editing ? "done" : "send"}
              onKeyDown={(e) => {
                if (editing && e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              onFocus={() => setTray(null)}
              className="w-full bg-transparent px-4 pb-3 pt-1 font-heading text-2xl font-bold leading-tight text-foreground outline-none placeholder:text-muted-foreground/80"
            />
            {titleError && (
              <p id="item-sheet-title-error" role="alert" className="flex items-center gap-1.5 px-4 pb-3 text-xs font-medium text-destructive">
                <CircleAlert className="size-3.5" />
                {titleError}
              </p>
            )}
            {!!titleMatches?.length && (
              <div className="flex flex-wrap gap-1.5 px-4 pb-3" aria-live="polite">
                {titleMatches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      tick();
                      m.onPress();
                      titleRef.current?.focus();
                    }}
                    title={m.pending ? "Take the words out of the title" : "Put the words back in the title"}
                    aria-label={m.pending ? `Set ${m.label}` : `${m.label}, from the title. Put the words back`}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-full pl-2.5 pr-2 text-xs font-medium text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      m.pending ? "border border-dashed border-primary/60" : "bg-primary/10"
                    )}
                  >
                    {m.icon}
                    {m.label}
                    {m.pending ? <Check className="size-3" /> : <X className="size-3" />}
                  </button>
                ))}
              </div>
            )}
            {bandExtra}
          </div>

          {!expanded ? (
            <>
              <div className="flex shrink-0 items-center gap-1.5 px-3 py-2">
                <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
                  {quickFields!.map((f) => (
                    <Chip key={f.id} label={f.label} icon={f.icon} on={tray === f.id} onClick={() => openTray(f.id)} />
                  ))}
                  <Chip label="More" icon={<Ellipsis className="size-3.5 text-muted-foreground" />} ghost onClick={grow} title="Show every field" />
                </div>
                <button
                  type="submit"
                  aria-label={submitLabel}
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground outline-none transition-transform focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95"
                >
                  <ArrowUp className="size-5" />
                </button>
              </div>
              {trayField && (
                <div ref={contentRef} className="min-h-0 overflow-y-auto border-t border-border px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
                  <div className="mb-2 flex items-center">
                    <span className="flex-1 text-sm font-semibold">{trayField.trayLabel}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={trayContext.close}>
                      Keyboard
                    </Button>
                  </div>
                  <TrayContext.Provider value={trayContext}>{trayField.editor}</TrayContext.Provider>
                </div>
              )}
            </>
          ) : (
            <>
              <div ref={contentRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-none px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {children}
                {editing && onDelete && (
                  <ListGroup>
                    <ListItem asChild>
                      <button type="button" onClick={requestDelete} className="min-h-[55px] font-medium text-destructive">
                        {deleteLabel}
                      </button>
                    </ListItem>
                  </ListGroup>
                )}
              </div>
              {!editing && (
                <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
                  <span className="hidden flex-1 text-xs text-muted-foreground lg:block">
                    <Kbd>Return</Kbd> adds · <Kbd>Esc</Kbd> closes
                  </span>
                  <Button type="submit" className="h-11 flex-1 rounded-xl text-sm lg:flex-none lg:px-5">
                    {submitLabel}
                  </Button>
                </div>
              )}
            </>
          )}
        </form>
      )}
    </BottomSheet>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 items-center rounded-[5px] border border-b-2 border-border bg-card px-1.5 font-sans text-[10.5px] font-semibold text-foreground/80">
      {children}
    </kbd>
  );
}

function Chip({
  label,
  icon,
  on,
  ghost,
  onClick,
  title,
}: {
  label: string;
  icon?: React.ReactNode;
  on?: boolean;
  ghost?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={ghost ? undefined : on}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        on ? "border-primary/45 bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-muted/60",
        ghost && "border-dashed text-muted-foreground"
      )}
    >
      {icon}
      <span className="max-w-[10rem] truncate">{label}</span>
    </button>
  );
}

// ── The list ─────────────────────────────────────────────────────────────

interface PropertyGroupContextValue {
  openId: string | null;
  setOpenId: (id: string | null) => void;
}
const PropertyGroupContext = React.createContext<PropertyGroupContextValue | null>(null);

/** A ListGroup of PropertyRows, with an optional micro label above it. */
export function PropertyGroup({ label, children }: { label?: string; children: React.ReactNode }) {
  const shared = React.useContext(PropertyGroupContext);
  const [ownOpen, setOwnOpen] = React.useState<string | null>(null);
  const value = React.useMemo(() => shared ?? { openId: ownOpen, setOpenId: setOwnOpen }, [shared, ownOpen]);
  return (
    <div className="space-y-1.5">
      {label && <p className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>}
      <PropertyGroupContext.Provider value={value}>
        <ListGroup>{children}</ListGroup>
      </PropertyGroupContext.Provider>
    </div>
  );
}

/** Lets every PropertyGroup inside share one open row. */
export function PropertyRows({ children }: { children: React.ReactNode }) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const value = React.useMemo(() => ({ openId, setOpenId }), [openId]);
  return (
    <PropertyGroupContext.Provider value={value}>
      <div className="space-y-3">{children}</div>
    </PropertyGroupContext.Provider>
  );
}

/** Close the row or tray this editor sits in, after a final choice (a person). */
export function useClosePropertyRow(): () => void {
  const ctx = React.useContext(PropertyGroupContext);
  const trayCtx = React.useContext(TrayContext);
  return React.useCallback(() => {
    ctx?.setOpenId(null);
    trayCtx?.close();
  }, [ctx, trayCtx]);
}

export interface PropertyRowProps {
  id: string;
  leading: React.ReactNode;
  label: string;
  value?: string;
  valueSet?: boolean;
  error?: string | null;
  control?: React.ReactNode;
  children?: React.ReactNode;
}

/** A line item that states one property and opens its editor in place (E2, E3). */
export function PropertyRow({ id, leading, label, value, valueSet = true, error, control, children }: PropertyRowProps) {
  const ctx = React.useContext(PropertyGroupContext);
  const isOpen = ctx?.openId === id;
  const opens = !control && children != null;
  const bodyId = `property-${id}`;
  const toggle = () => {
    if (!opens || !ctx) return;
    tick();
    ctx.setOpenId(isOpen ? null : id);
  };
  const content = (
    <>
      <ListItemLeading className="mt-0">{leading}</ListItemLeading>
      <ListItemContent>
        <span className="text-sm font-medium text-foreground">{label}</span>
        {error && <span className="block text-xs text-destructive">{error}</span>}
      </ListItemContent>
      <ListItemTrailing className="mt-0 max-w-[60%]">
        {control ?? (
          <>
            {value != null && (
              <span
                className={cn(
                  "truncate text-sm tabular-nums",
                  error ? "font-medium text-destructive" : isOpen ? "font-semibold text-primary" : valueSet ? "font-medium text-foreground" : "text-muted-foreground"
                )}
              >
                {value}
              </span>
            )}
            {opens && <ChevronRight className={cn("size-4 transition-transform motion-reduce:transition-none", isOpen && "rotate-90")} />}
          </>
        )}
      </ListItemTrailing>
    </>
  );
  return (
    <div>
      {opens ? (
        <ListItem asChild expanded={isOpen} className="min-h-[55px]">
          <button type="button" aria-expanded={isOpen} aria-controls={bodyId} onClick={toggle}>
            {content}
          </button>
        </ListItem>
      ) : (
        <ListItem className="min-h-[55px] hover:bg-transparent">{content}</ListItem>
      )}
      {opens && isOpen && (
        <ListItemBody id={bodyId} expanded className="bg-muted/40 [&>div]:pl-[52px]">
          <div className="space-y-3 pt-1">{children}</div>
        </ListItemBody>
      )}
    </div>
  );
}

/** The neutral tile a property row leads with. Section hues stay for identity (H2). */
export function PropertyIcon({ Icon }: { Icon: LucideIcon }) {
  return (
    <span className="grid size-7 place-items-center rounded-[9px] bg-muted text-muted-foreground">
      <Icon className="size-[15px]" strokeWidth={2.1} />
    </span>
  );
}

// ── Editors ─────────────────────────────────────────────────────────────

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

/** Quick choices as chips. Arrow keys move between them. */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly ChoiceOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    buttons[(i + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5" onKeyDown={onKeyDown}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value || "_none"}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              tick();
              onChange(o.value);
            }}
            className={cn(
              "h-9 rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              on ? "border-primary/45 bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-muted/60"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The Due editor: quick choices, a week strip that steps by weeks, and Month. */
export function DueEditor({ value, onChange, allowNone = true }: { value: string; onChange: (value: string) => void; allowNone?: boolean }) {
  const today = todayISO();
  const [offset, setOffset] = React.useState(() => weekStripOffsetFor(value, today));
  const [monthOpen, setMonthOpen] = React.useState(false);
  const days = weekStrip(today, offset);
  const choices = dueQuickChoices(today).filter((c) => allowNone || c.value);
  const picked = choices.find((c) => c.value === value)?.value ?? null;
  const pick = (next: string) => {
    onChange(next);
    if (next) setOffset(weekStripOffsetFor(next, today));
  };
  const onStripKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    buttons[Math.min(buttons.length - 1, Math.max(0, i + step))]?.focus();
  };
  return (
    <div className="space-y-3">
      <ChoiceChips options={choices.map((c) => ({ value: c.value, label: c.label }))} value={picked} onChange={pick} ariaLabel="Quick dates" />
      <div role="radiogroup" aria-label="Pick a day" className="grid grid-cols-7 gap-0.5" onKeyDown={onStripKey}>
        {days.map((d) => {
          const on = d.iso === value;
          return (
            <button
              key={d.iso}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={new Date(`${d.iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              onClick={() => {
                tick();
                pick(d.iso);
              }}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                on ? "bg-primary text-primary-foreground" : d.isToday ? "border border-border hover:bg-muted/60" : "hover:bg-muted/60"
              )}
            >
              <span className={cn("text-[10px] font-semibold", on ? "text-primary-foreground/80" : "text-muted-foreground")}>{d.letter}</span>
              <span className="text-sm font-medium tabular-nums">{d.day}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1">
        <span className="flex-1 text-xs text-muted-foreground">{weekStripMonth(days)}</span>
        {offset > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setOffset((o) => o - 1)}>
            Earlier
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={() => setOffset((o) => o + 1)}>
          Later
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setMonthOpen(true)}>
          Month
        </Button>
      </div>
      <MonthDatePicker
        open={monthOpen}
        initialDate={value ? new Date(`${value}T12:00:00`) : new Date()}
        onClose={() => setMonthOpen(false)}
        onSelect={(date) => {
          pick(toISODate(date));
          setMonthOpen(false);
        }}
      />
    </div>
  );
}

/** The Time editor: named times, then the time wheel. '' is any time. */
export function TimeEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const picked = TIME_QUICK_CHOICES.find((c) => c.value === value)?.value ?? null;
  return (
    <div className="space-y-3">
      <ChoiceChips options={TIME_QUICK_CHOICES.map((c) => ({ value: c.value, label: timeChoiceLabel(c) }))} value={picked} onChange={onChange} ariaLabel="Quick times" />
      <div className="rounded-xl bg-card py-1">
        <TimeScrollField value={value || "09:00"} onChange={onChange} />
      </div>
    </div>
  );
}

export interface PersonOption {
  id: string;
  name: string;
  face: React.ReactNode;
}

/** Faces to tap (Who editor). */
export function PeoplePicker({ people, value, onChange }: { people: PersonOption[]; value: string; onChange: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Who" className="flex gap-3 overflow-x-auto py-1 [scrollbar-width:none]">
      {people.map((p) => {
        const on = p.id === value;
        return (
          <button
            key={p.id || "_anyone"}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              tick();
              onChange(p.id);
            }}
            className="group flex min-w-12 flex-col items-center gap-1 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className={cn("rounded-full border-2 p-0.5", on ? "border-primary" : "border-transparent group-hover:border-border")}>{p.face}</span>
            <span className={cn("max-w-16 truncate text-[11px] font-medium", on ? "text-foreground" : "text-muted-foreground")}>{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}
