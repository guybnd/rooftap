"use client";

// Rooftap Assistant: the pop-up chat. It grows out of the + (swipe up or hold
// the mobile +, the capture sheet's "Chat with Rooftap", a "Rooftap answered"
// toast) over whatever page is open, and minimising shrinks it back into the
// +. Minimised, the conversation stays: a reply that lands meanwhile lights
// the + dot and shows the "Rooftap answered" toast, and reopening shows it. core's
// openAssistantPopup() reaches this one host, mounted inside the app shell.
// Native twin: apps/mobile/src/features/assistant/chat-popup.tsx.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Maximize2, MessagesSquare, SquarePen, Trash2, X } from "lucide-react";
import {
  chatChoices,
  deleteConversation,
  moduleHelper,
  openAssistantPopup,
  popupStatus,
  popupTitle,
  useAssistantPopupState,
  usePopupChats,
  usePopupSlot,
  usePopupSlotValue,
  usePopupThreadLifecycle,
  useAssistantPending,
  useAssistantThread,
  useModules,
  type AssistantConversation,
  type AssistantEdgePace,
  type ChatChoice,
  type PopupSlot,
  type ThreadTarget,
} from "@homeup/core";
import { cn } from "@/lib/utils";
import { useDataCache } from "@/lib/data-cache";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useMediaQuery } from "@/lib/desktop-layout";
import { assistantApi } from "@/lib/assistant-client";
import { archiveToast } from "@/lib/archive-toast";
import { ThreadFooter, ThreadMessages } from "@/app/assistant/thread-body";
import { ConversationRow } from "@/app/assistant/conversation-row";
import { ListGroup } from "@/components/ui/list-item";
import { Button } from "@/components/ui/button";
import { PromptBadge } from "@/components/ui/prompt-badge";
import { devicePosition } from "@/lib/device-position";
import { RooftapMark, RooftapTile } from "@/components/brand/rooftap-mark";
import { LeadingTile } from "@/components/ui/leading-tile";
import { sectionIconFor } from "@/lib/section-icons";
import { useSpectrumEdge } from "@/components/spectrum-edge";

const popupToast = { error: (m: string) => toast.error(m), message: (m: string) => toast(m) };

/** What the thread hands its card (core PopupSlot): the card stays put while the chat inside changes. */
interface PopupContent {
  /** Changes with the chat, so the inside starts clean. */
  key: number;
  pace: AssistantEdgePace;
  title: string;
  body: ReactNode;
}

export function AssistantChatPopup() {
  const modules = useModules();
  const { group } = useDataCache();
  const on = modules.isEnabled("assistant") && !!group?.id;
  const { state, minimize, dismissBack, fresh, remember } = useAssistantPopupState(on);
  const slot = usePopupSlot<PopupContent>();

  if (!on) return null;
  // The thread is keyed (a new chat starts clean) but the card is not, so
  // hopping between chats swaps what is inside it, with no shrink and grow.
  return (
    <>
    <PopupThread
      key={state.key}
      slotKey={state.key}
      slot={slot}
      open={state.open}
      target={state.target}
      ask={state.ask}
      back={state.back}
      onMinimize={minimize}
      onNavigateAway={() => minimize("navigate")}
      onDismissBack={dismissBack}
      onFresh={fresh}
      onConversation={remember}
    />
    <PopupCard slot={slot} open={state.open} onMinimize={minimize} />
    </>
  );
}

function PopupCard({ slot, open, onMinimize }: { slot: PopupSlot<PopupContent>; open: boolean; onMinimize: () => void }) {
  const content = usePopupSlotValue(slot);
  return (
    <PopupSurface open={open} pace={content?.pace ?? "rest"} onMinimize={onMinimize} title={content?.title || "Rooftap"}>
      {content && <Fragment key={content.key}>{content.body}</Fragment>}
    </PopupSurface>
  );
}

function PopupThread({
  slotKey,
  slot,
  open,
  target,
  ask,
  back,
  onMinimize,
  onNavigateAway,
  onDismissBack,
  onFresh,
  onConversation,
}: {
  slotKey: number;
  slot: PopupSlot<PopupContent>;
  open: boolean;
  target: ThreadTarget;
  ask?: string;
  back: "pill" | "bubble" | null;
  onMinimize: () => void;
  /** A tap in the chat opened another page: put the chat away and offer it back. */
  onNavigateAway: () => void;
  onDismissBack: () => void;
  onFresh: () => void;
  onConversation: (c: AssistantConversation | null) => void;
}) {
  const router = useRouter();
  const { isOnline } = useDataCache();
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // The screen behind the chat, so "this" in a question can mean what is open.
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  // Docked on a desktop the page behind stays usable; on a phone the card covers it.
  const docked = useMediaQuery("(min-width: 768px)");
  useEffect(() => {
    // A tap in the chat (a row, a link) opened another page: the item opens as
    // usual, and a "Back to chat" pill brings the chat back.
    if (pathRef.current !== pathname && openRef.current && !docked) onNavigateAway();
    pathRef.current = pathname;
  }, [pathname, docked, onNavigateAway]);
  const thread = useAssistantThread(target, {
    api: assistantApi,
    presence: () => (document.visibilityState !== "visible" ? "background" : openRef.current ? "here" : "away"),
    toast: popupToast,
    screen: () => pathRef.current,
    here: devicePosition,
  });
  const { conversation, loadError, send, reload } = thread;
  // A delete can be taken back on servers that have archiving.
  const modules = useModules();
  const canUndo = modules.server("assistant.archive");

  usePopupThreadLifecycle({ open, ask, conversation, loadError, send, reload, onConversation });

  const expand = () => {
    if (!conversation) return;
    onMinimize();
    router.push(`/assistant/${conversation.id}`);
  };

  // The header's chats button swaps the thread for the list of chats; picking one opens it here.
  const [showChats, setShowChats] = useState(false);
  // Changes waiting on your OK in your other chats (this one shows its own).
  const pendingCount = Math.max(0, useAssistantPending() - (showChats ? 0 : conversation?.pending ?? 0));
  const pick = (id: string) => {
    setShowChats(false);
    if (id !== conversation?.id) openAssistantPopup({ conversationId: id });
  };
  const allChats = () => {
    onMinimize();
    router.push("/assistant");
  };

  const helper = conversation?.helper ?? target.helper ?? null;
  const title = popupTitle(showChats, conversation, target.id, helper);
  // The chats it can hop between (Rooftap and each helper), shown as a strip under the header.
  const choices = modules.server("assistant.helpers") ? chatChoices((id) => modules.isEnabled(id)) : [];
  const [listening, setListening] = useState(false);
  // Re-read each minute so a quick ask's "more min" counts down while the pop-up is open.
  const [, setMinute] = useState(0);
  useEffect(() => {
    if (!open || conversation?.kind !== "quick") return;
    const timer = setInterval(() => setMinute((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, [open, conversation?.kind]);
  const status = showChats ? null : listening ? "Listening" : popupStatus(conversation, target.id, new Date(), helper);
  const iconButton =
    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground";

  const backToChat = !open && back && (
      <BackToChat
        mode={back}
        label={popupTitle(false, conversation, target.id, helper) || "Rooftap"}
        helper={helper}
        working={thread.thinking}
        onOpen={() => openAssistantPopup()}
        onDismiss={onDismissBack}
      />
  );

  const body = (
    <>
      <div className="flex items-center gap-1 border-b border-border pb-2 pl-3.5 pr-1.5 md:pt-2">
        {!showChats && (
          <span className="relative shrink-0">
            <RooftapTile working={thread.thinking} />
            {/* A helper wears its module's tile as a badge. */}
            {helper && (
              <LeadingTile
                sectionId={helper}
                Icon={sectionIconFor(helper)}
                size="sm"
                className="absolute -bottom-1 -right-1 size-[18px] rounded-[6px] ring-2 ring-card [&_svg]:size-[11px]"
              />
            )}
          </span>
        )}
        <div className={cn("min-w-0 flex-1", showChats ? "pl-0.5" : "pl-2")}>
          <p className="truncate text-[15px] font-semibold text-foreground">{title}</p>
          {status && <p className="truncate text-xs text-muted-foreground tabular-nums">{status}</p>}
        </div>
        <button
          type="button"
          onClick={() => setShowChats((v) => !v)}
          aria-label={showChats ? "Back to this chat" : "Your chats"}
          aria-pressed={showChats}
          className={cn(iconButton, "relative", showChats && "bg-muted text-foreground")}
        >
          <MessagesSquare className="h-4.5 w-4.5" />
          {/* A change waits on your OK somewhere: the chats list shows where. */}
          <PromptBadge count={pendingCount} className="right-0.5 top-0.5" />
        </button>
        <button type="button" onClick={onFresh} aria-label="New quick ask" className={iconButton}>
          <SquarePen className="h-4.5 w-4.5" />
        </button>
        {!showChats && conversation && conversation.kind !== "household" && (
          <button
            type="button"
            onClick={() => void (canUndo ? deleteConversation(assistantApi, conversation, archiveToast) : thread.remove()).then((gone) => gone && onFresh())}
            aria-label="Delete this conversation"
            className={iconButton}
          >
            <Trash2 className="h-4.5 w-4.5" />
          </button>
        )}
        {!showChats && conversation && (
          <button type="button" onClick={expand} aria-label="Open full page" className={iconButton}>
            <Maximize2 className="h-4.5 w-4.5" />
          </button>
        )}
        <button type="button" onClick={onMinimize} aria-label="Minimise" className={iconButton}>
          <ChevronDown className="h-5 w-5" />
        </button>
      </div>
      {!showChats && choices.length > 1 && <HelperStrip choices={choices} current={helper} />}
      {showChats ? (
        <PopupChats currentId={conversation?.id ?? null} onPick={pick} onAll={allChats} />
      ) : (
        <>
          <ThreadMessages thread={thread} offline={!isOnline} className="min-h-0 flex-1 overflow-y-auto px-4" />
          <ThreadFooter
            thread={thread}
            offline={!isOnline}
            autoFocus={target.id === "new" && !target.helper && !ask}
            onFresh={onFresh}
            band
            lookingAt={pathname}
            onListening={setListening}
            className="px-3 pb-3"
          />
        </>
      )}
    </>
  );

  // Every render hands the card what it shows now (before paint, so a hop never flashes the old chat).
  const pace: AssistantEdgePace = thread.thinking ? "thinking" : listening ? "listening" : "rest";
  useLayoutEffect(() => {
    slot.set({ key: slotKey, pace, title: title || "Rooftap", body });
  });

  return backToChat || null;
}

/**
 * The chats the pop-up can hop between: plain Rooftap, then each helper that
 * is on (core chatChoices). The one on show is filled; a tap opens another,
 * carrying on where it was left.
 */
// Where the strip was scrolled. Each chat draws its own header, so a hop
// mounts a new strip: it starts where the last one was, not back at the start.
let stripX = 0;

function HelperStrip({ choices, current }: { choices: ChatChoice[]; current: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    strip.scrollLeft = stripX;
    // The chip on show comes into view if the last strip had it off to one side.
    strip.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, []);
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label="Chats"
      onScroll={(e) => {
        stripX = e.currentTarget.scrollLeft;
      }}
      className="flex gap-1.5 overflow-x-auto border-b border-border px-3.5 py-2 [scrollbar-width:none]"
    >
      {choices.map((c) => {
        const on = c.helper === current;
        return (
          <button
            key={c.helper ?? "rooftap"}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => !on && openAssistantPopup(c.helper ? { helper: c.helper } : { plain: true })}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium",
              on ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-muted/70"
            )}
          >
            {c.helper ? (
              <LeadingTile sectionId={c.helper} Icon={sectionIconFor(c.helper)} size="sm" className="size-4 rounded-[5px] [&_svg]:size-[10px]" />
            ) : (
              <RooftapMark className="size-3.5" />
            )}
            {c.helper ? moduleHelper(c.helper)?.label.replace(/ helper$/, "") ?? c.label : c.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The chat, put away, offering itself back: a "Back to <chat>" pill after a
 * tap in the chat opened an item, or a bubble at the edge for a helper chat
 * swiped away. Either one opens the chat where it was; the x lets it go (the
 * chat stays behind the +).
 */
function BackToChat({
  mode,
  label,
  helper,
  working,
  onOpen,
  onDismiss,
}: {
  mode: "pill" | "bubble";
  label: string;
  helper: string | null;
  working: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const badge = helper ? (
    <LeadingTile
      sectionId={helper}
      Icon={sectionIconFor(helper)}
      size="sm"
      className="absolute -bottom-1 -right-1 size-[18px] rounded-[6px] ring-2 ring-card [&_svg]:size-[11px]"
    />
  ) : null;
  if (mode === "pill") {
    return (
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-40 flex justify-center px-4 md:hidden">
        <div className="flex items-center gap-1 rounded-full bg-popover py-1 pl-1 pr-1 shadow-[var(--card-shadow)] ring-1 ring-border">
          <button type="button" onClick={onOpen} className="flex min-h-11 items-center gap-2 rounded-full pl-1 pr-3 text-sm font-medium text-foreground hover:bg-muted">
            <span className="relative">
              <RooftapTile size="sm" working={working} />
              {badge}
            </span>
            Back to {label}
          </button>
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="group fixed bottom-[calc(env(safe-area-inset-bottom)+6rem)] right-3 z-40 md:bottom-24 md:right-6">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${label}`}
        className="relative flex size-14 items-center justify-center rounded-full bg-popover shadow-[var(--card-shadow)] ring-1 ring-border"
      >
        <RooftapTile working={working} />
        {badge}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Close ${label} bubble`}
        className="absolute -left-2 -top-2 inline-flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground ring-2 ring-background"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

/**
 * The pop-up's list of chats: the Household thread, kept chats, open quick
 * asks and the latest closed ones, the same rows as the Assistant space.
 * Paints from the cache at once and refreshes from the server.
 */
function PopupChats({ currentId, onPick, onAll }: { currentId: string | null; onPick: (id: string) => void; onAll: () => void }) {
  const { sections, error, reload } = usePopupChats(assistantApi);
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
      {error && <p className="px-1 text-sm text-muted-foreground">{error}</p>}
      {sections.length === 0 && !error && (
        <p className="px-1 py-10 text-center text-sm text-muted-foreground">No chats yet. Ask something and it shows here.</p>
      )}
      {sections.map((section) => (
        <div key={section.label} className="space-y-2">
          <p className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{section.label}</p>
          <ListGroup>
            {section.rows.map((c) => (
              <ConversationRow key={c.id} conversation={c} current={c.id === currentId} onSelect={() => onPick(c.id)} onChanged={reload} />
            ))}
          </ListGroup>
        </div>
      ))}
      <div className="flex justify-center">
        <Button variant="ghost" className="h-11" onClick={onAll}>
          All chats
        </Button>
      </div>
    </div>
  );
}

/**
 * The card: grows from the + (scaling up from its bottom edge while the +'s
 * coral fades into the card), and shrinks back into it. On desktop it sits
 * bottom right instead. Lifts over the on-screen keyboard like the capture
 * sheet (use-keyboard-inset).
 */
function PopupSurface({
  open,
  pace,
  onMinimize,
  title,
  children,
}: {
  open: boolean;
  /** How busy Rooftap is: the spectrum edge turns faster while it works. */
  pace: AssistantEdgePace;
  onMinimize: () => void;
  title: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  useSpectrumEdge(cardRef, pace, mounted);
  const keyboardInset = useKeyboardInset(open);
  // Docked (md and up) the page behind stays usable, so the card is not modal.
  const docked = useMediaQuery("(min-width: 768px)");

  useEffect(() => {
    if (open) {
      setMounted(true);
      // One frame at the closed pose first, so the grow transitions.
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    // The shrink's transitionend unmounts it. Without a transition (reduced
    // motion, a hidden tab) that never fires, and the invisible layer would
    // keep taking every tap, so unmount after the exit time regardless.
    const fallback = setTimeout(() => setMounted(false), 600);
    return () => clearTimeout(fallback);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onMinimize();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onMinimize]);

  if (!mounted) return null;
  return createPortal(
    // On a desktop it docks like a Messenger chat: no scrim, the page behind
    // stays usable, and it sits above the docked + (Hearth §13.7).
    <div className="pointer-events-none fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="Minimise"
        tabIndex={-1}
        onClick={onMinimize}
        className={cn(
          "pointer-events-auto absolute inset-0 bg-black/40 transition-opacity duration-[var(--motion-base)] md:hidden",
          shown ? "opacity-100" : "opacity-0"
        )}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal={!docked}
        aria-label={title}
        onTransitionEnd={(e) => {
          // Tailwind v4's translate-* and scale-* set the translate and scale
          // properties, not transform, so the card's own opacity marks the end.
          if (e.target === e.currentTarget && e.propertyName === "opacity" && !open) setMounted(false);
        }}
        style={{
          bottom: keyboardInset > 0 ? keyboardInset + 10 : undefined,
          maxHeight: keyboardInset > 0 ? `calc(100dvh - ${keyboardInset}px - 2rem)` : undefined,
        }}
        className={cn(
          "spectrum-edge pointer-events-auto absolute inset-x-2.5 bottom-[calc(env(safe-area-inset-bottom)+0.625rem)] flex h-[min(74dvh,680px)] flex-col overflow-hidden rounded-[28px] bg-popover shadow-[var(--card-shadow)]",
          // Its own view-transition layer: a page change slides under it, not over it.
          "origin-bottom md:inset-x-auto md:bottom-24 md:right-6 md:h-[min(78dvh,720px)] md:w-[420px] md:origin-bottom-right [view-transition-name:chat-dock]",
          "transition-[translate,scale,opacity] will-change-transform",
          shown
            ? "translate-y-0 scale-100 opacity-100 duration-[var(--motion-slow)] ease-[var(--motion-ease-out)]"
            : "translate-y-[2.75rem] scale-[0.08] opacity-0 duration-[var(--motion-exit)] ease-[var(--motion-ease-in)] md:translate-y-0"
        )}
      >
        <div className="items-center pb-1 pt-2.5 md:hidden">
          <div className="mx-auto h-1.5 w-10 rounded-full bg-foreground/20" />
        </div>
        {children}
        {/* The +'s coral, fading into the card as it grows out of it. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 bg-primary transition-opacity duration-[var(--motion-base)] md:hidden",
            shown ? "opacity-0" : "opacity-100"
          )}
        />
      </div>
    </div>,
    document.body
  );
}
