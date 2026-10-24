"use client";

// What's new (whats-new/README.md), the web twin of apps/mobile's
// components/whats-new: on Home, everything this browser hasn't seen shows
// once, spotlight cards for big launches first, then the list (a bottom sheet
// on a phone, a centred card on a wide screen). Settings > What's new keeps
// the full history. Seen state is per browser (localStorage, via core).
import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import {
  fixesLabel,
  getModule,
  getSection,
  todayISO,
  useModulePicker,
  useWhatsNew,
  useWhatsNewHistory,
  whatsNewDayLabel,
  whatsNewHeadline,
  type WhatsNewEntry,
  type WhatsNewView,
} from "@homeup/core";
import { Button } from "@/components/ui/button";
import { LeadingTile } from "@/components/ui/leading-tile";
import { ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle, ListItemTrailing } from "@/components/ui/list-item";
import { SectionGlow } from "@/components/ui/section-glow";
import { SettingsPanel } from "@/components/settings-panel";
import { useDataCache } from "@/lib/data-cache";
import { sectionIcons } from "@/lib/section-icons";

const SETTLE_MS = 900;
const HISTORY_HREF = "/settings/whats-new";
const MICRO_LABEL = "px-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground";
// Hearth's inset level: a darker fill, no border, inside the sheet.
const INSET_GROUP = "rounded-[20px] border-0 bg-muted shadow-none";

function tileFor(entry: WhatsNewEntry) {
  if (entry.module === "app") return { sectionId: "home", Icon: Sparkles };
  const iconId = getSection(entry.module)?.iconId ?? getModule(entry.module)?.iconId;
  return { sectionId: entry.module, Icon: (iconId && sectionIcons[iconId]) || Sparkles };
}

const actionLabel = (entry: WhatsNewEntry) => (entry.kind === "feature" ? "Try it" : "Show me");

function WhatsNewRow({ entry, onOpen }: { entry: WhatsNewEntry; onOpen?: (link: string) => void }) {
  const { sectionId, Icon } = tileFor(entry);
  const link = onOpen && entry.link;
  const body = (
    <>
      <ListItemLeading>
        <LeadingTile sectionId={sectionId} Icon={Icon} size="md" />
      </ListItemLeading>
      <ListItemContent>
        <ListItemTitle>{entry.title}</ListItemTitle>
        <ListItemMeta>{entry.body}</ListItemMeta>
      </ListItemContent>
      {link && (
        <ListItemTrailing>
          <span className="text-xs font-semibold text-primary">{actionLabel(entry)}</span>
        </ListItemTrailing>
      )}
    </>
  );
  if (!link) return <ListItem>{body}</ListItem>;
  return (
    <ListItem asChild>
      <button type="button" onClick={() => onOpen(link)} className="w-full cursor-pointer text-left">
        {body}
      </button>
    </ListItem>
  );
}

function FixesRow({ fixes }: { fixes: WhatsNewEntry[] }) {
  const [open, setOpen] = React.useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center justify-between px-3.5 py-3 text-xs text-muted-foreground"
      >
        {fixesLabel(fixes.length)}
        <Chevron className="size-4" />
      </button>
      {open && (
        <ul className="space-y-2 px-3.5 pb-3 text-xs text-muted-foreground">
          {fixes.map((f) => (
            <li key={f.id}>
              {f.title}. {f.body}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WhatsNewGroups({
  view,
  onOpen,
  onMore,
  alwaysHeaders,
}: {
  view: WhatsNewView;
  onOpen?: (link: string) => void;
  onMore?: () => void;
  alwaysHeaders?: boolean;
}) {
  const today = todayISO();
  const headers = alwaysHeaders || view.showVersions;
  return (
    <div className="space-y-4">
      {view.groups.map((g) => (
        <div key={g.version ?? "latest"}>
          {headers && (
            <div className={MICRO_LABEL}>
              {g.version ?? "Latest"} · {whatsNewDayLabel(g.date, today)}
            </div>
          )}
          <ListGroup className={INSET_GROUP}>
            {g.entries.map((e) => (
              <WhatsNewRow key={e.id} entry={e} onOpen={onOpen} />
            ))}
          </ListGroup>
        </div>
      ))}
      {(view.moreCount > 0 || view.fixes.length > 0) && (
        <ListGroup className={INSET_GROUP}>
          {view.moreCount > 0 && (
            <ListItem asChild>
              <button type="button" onClick={onMore} className="w-full cursor-pointer text-left">
                <ListItemContent>
                  <ListItemTitle>{view.moreCount === 1 ? "1 more change" : `${view.moreCount} more changes`}</ListItemTitle>
                </ListItemContent>
                <ListItemTrailing>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </ListItemTrailing>
              </button>
            </ListItem>
          )}
          {view.fixes.length > 0 && <FixesRow fixes={view.fixes} />}
        </ListGroup>
      )}
    </div>
  );
}

function Spotlight({
  entry,
  index,
  count,
  onNext,
  onSkip,
  onTry,
}: {
  entry: WhatsNewEntry;
  index: number;
  count: number;
  onNext: () => void;
  onSkip: () => void;
  onTry?: () => void;
}) {
  const { sectionId, Icon } = tileFor(entry);
  const label = getSection(entry.module)?.label ?? getModule(entry.module)?.label;
  return (
    <div className="relative isolate flex min-h-full flex-col">
      <SectionGlow sectionId={sectionId} />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 p-5 py-8 sm:py-14">
        <div className="flex items-center justify-between">
          <span className={MICRO_LABEL.replace("px-1 pb-1.5 ", "")}>
            What&apos;s new{count > 1 ? ` · ${index + 1} of ${count}` : ""}
          </span>
          <button type="button" onClick={onSkip} className="text-sm font-semibold text-muted-foreground hover:text-foreground">
            Skip
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-3.5 rounded-[28px] border border-border bg-card p-6">
          <LeadingTile sectionId={sectionId} Icon={Icon} size="xl" />
          {label && <span className={MICRO_LABEL.replace("px-1 pb-1.5 ", "")}>New in {label}</span>}
          <DialogPrimitive.Title className="font-heading text-2xl font-bold tracking-[-0.02em] text-foreground">
            {entry.title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-sm leading-relaxed text-foreground/85">{entry.body}</DialogPrimitive.Description>
        </div>
        {count > 1 && (
          <div aria-hidden className="flex items-center justify-center gap-1.5">
            {Array.from({ length: count }, (_, i) => (
              <span key={i} className={i === index ? "h-1.5 w-[18px] rounded-full bg-primary" : "size-1.5 rounded-full bg-border"} />
            ))}
          </div>
        )}
        <div className="flex gap-2.5">
          {onTry && (
            <Button variant="secondary" className="h-[50px] flex-1 rounded-2xl text-[15px]" onClick={onTry}>
              Try it
            </Button>
          )}
          <Button className="h-[50px] flex-1 rounded-2xl text-[15px]" onClick={onNext}>
            {index === count - 1 ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function WhatsNewDialog() {
  const router = useRouter();
  const pathname = usePathname();
  const { group, userSettings, isGroupOwner, pendingInvitations } = useDataCache();
  const picker = useModulePicker({ isOwner: isGroupOwner, pendingInvitations: pendingInvitations.length });
  const onHome = pathname === "/home";
  const [settled, setSettled] = React.useState(false);
  React.useEffect(() => {
    if (!onHome || !group || picker.open) return;
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [onHome, group, picker.open]);

  const { open, view, dismiss } = useWhatsNew({
    platform: "web",
    hidden: userSettings?.hidden_sections,
    ready: settled && onHome && !picker.open,
  });
  const [page, setPage] = React.useState(0);
  if (!view) return null;

  const spotlight = view.spotlights[page];
  const hasList = view.groups.length > 0 || view.fixes.length > 0;
  const go = (href: string) => {
    dismiss();
    router.push(href);
  };
  const next = () => {
    if (page + 1 < view.spotlights.length || hasList) setPage((p) => p + 1);
    else dismiss();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-[var(--motion-fast)] data-ending-style:opacity-0 data-starting-style:opacity-0" />
        {spotlight ? (
          <DialogPrimitive.Popup className="fixed inset-0 z-50 overflow-y-auto bg-background outline-none transition-opacity duration-[var(--motion-slow)] ease-[var(--motion-ease-out)] data-ending-style:opacity-0 data-starting-style:opacity-0">
            <Spotlight
              entry={spotlight}
              index={page}
              count={view.spotlights.length}
              onNext={next}
              onSkip={dismiss}
              onTry={spotlight.link ? () => go(spotlight.link as string) : undefined}
            />
          </DialogPrimitive.Popup>
        ) : (
          <DialogPrimitive.Popup className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88svh] flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-card p-5 pt-6 text-card-foreground shadow-xl outline-none transition-[transform,opacity] duration-[var(--motion-slow)] ease-[var(--motion-ease-out)] data-ending-style:translate-y-full data-starting-style:translate-y-full sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border sm:border-border sm:data-ending-style:translate-y-[-48%] sm:data-ending-style:opacity-0 sm:data-starting-style:translate-y-[-48%] sm:data-starting-style:opacity-0">
            <div className="space-y-1">
              <div className={MICRO_LABEL.replace("px-1 pb-1.5 ", "")}>What&apos;s new</div>
              <DialogPrimitive.Title className="font-heading text-2xl font-bold tracking-[-0.02em]">
                {whatsNewHeadline(view)}
              </DialogPrimitive.Title>
            </div>
            <WhatsNewGroups view={view} onOpen={go} onMore={() => go(HISTORY_HREF)} />
            <Button className="h-[50px] w-full shrink-0 rounded-2xl text-[15px]" onClick={dismiss}>
              Got it
            </Button>
            <p className="text-center text-xs text-muted-foreground">Every update is in Settings › About &amp; updates</p>
          </DialogPrimitive.Popup>
        )}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Settings > What's new: every entry this person has the feature for, by release. */
export function WhatsNewHistory() {
  const router = useRouter();
  const { userSettings } = useDataCache();
  const view = useWhatsNewHistory({ platform: "web", hidden: userSettings?.hidden_sections });
  return (
    <SettingsPanel icon={Sparkles} title="What's new">
      {view.total === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <WhatsNewGroups view={view} alwaysHeaders onOpen={(href) => router.push(href)} />
      )}
    </SettingsPanel>
  );
}
