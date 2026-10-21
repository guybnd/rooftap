"use client";

// Rooftap Assistant: the pop-up chat. It grows out of the + (swipe up or hold
// the mobile +, the capture sheet's "Chat with Rooftap", a "Rooftap answered"
// toast) over whatever page is open, and minimising shrinks it back into the
// +. Minimised, the conversation stays: a reply that lands meanwhile lights
// the + dot and shows the "Rooftap answered" toast, and reopening shows it. core's
// openAssistantPopup() reaches this one host, mounted inside the app shell.
// Native twin: apps/mobile/src/features/assistant/chat-popup.tsx.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Maximize2, MessagesSquare, SquarePen, Trash2 } from "lucide-react";
import {
  cachedConversations,
  conversationTitle,
  groupConversations,
  openAssistantPopup,
  onAssistantPopup,
  useAssistantThread,
  useModules,
  type AssistantConversation,
  type ThreadTarget,
} from "@homeup/core";
import { cn } from "@/lib/utils";
import { useDataCache } from "@/lib/data-cache";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { assistantApi } from "@/lib/assistant-client";
import { ThreadFooter, ThreadMessages } from "@/app/assistant/thread-body";
import { ConversationRow } from "@/app/assistant/conversation-row";
import { ListGroup } from "@/components/ui/list-item";
import { Button } from "@/components/ui/button";

const popupToast = { error: (m: string) => toast.error(m), message: (m: string) => toast(m) };

interface PopupState {
  open: boolean;
  /** Bumped to start a different conversation (remounts the thread). */
  key: number;
  target: ThreadTarget;
  ask?: string;
}

export function AssistantChatPopup() {
  const modules = useModules();
  const { group } = useDataCache();
  const on = modules.isEnabled("assistant") && !!group?.id;
  const [state, setState] = useState<PopupState>({ open: false, key: 0, target: { id: "new", kind: "quick" } });
  // The conversation on show, so a request for it (or a plain reopen) resumes rather than restarts.
  const current = useRef<AssistantConversation | null>(null);

  useEffect(() => {
    if (!on) return;
    return onAssistantPopup((request) => {
      setState((prev) => {
        const shown = current.current;
        if (request.conversationId) {
          if (shown?.id === request.conversationId) return { ...prev, open: true, ask: undefined };
          current.current = null;
          return { open: true, key: prev.key + 1, target: { id: request.conversationId } };
        }
        // A quick ask that has since closed stays on show: its footer offers Continue or Start fresh.
        if (request.ask || request.fresh) {
          current.current = null;
          return { open: true, key: prev.key + 1, target: { id: "new", kind: "quick" }, ask: request.ask };
        }
        return { ...prev, open: true };
      });
    });
  }, [on]);

  const minimize = useCallback(() => setState((prev) => ({ ...prev, open: false })), []);
  const fresh = useCallback(() => {
    current.current = null;
    setState((prev) => ({ open: true, key: prev.key + 1, target: { id: "new", kind: "quick" } }));
  }, []);
  const remember = useCallback((c: AssistantConversation | null) => {
    current.current = c;
  }, []);

  if (!on) return null;
  return (
    <PopupThread
      key={state.key}
      open={state.open}
      target={state.target}
      ask={state.ask}
      onMinimize={minimize}
      onFresh={fresh}
      onConversation={remember}
    />
  );
}

function PopupThread({
  open,
  target,
  ask,
  onMinimize,
  onFresh,
  onConversation,
}: {
  open: boolean;
  target: ThreadTarget;
  ask?: string;
  onMinimize: () => void;
  onFresh: () => void;
  onConversation: (c: AssistantConversation | null) => void;
}) {
  const router = useRouter();
  const { isOnline } = useDataCache();
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const thread = useAssistantThread(target, {
    api: assistantApi,
    presence: () => (document.visibilityState !== "visible" ? "background" : openRef.current ? "here" : "away"),
    toast: popupToast,
  });
  const { conversation, loadError, send, reload } = thread;

  useEffect(() => onConversation(conversation), [conversation, onConversation]);

  // An ask handed over (the capture sheet's box) goes out once.
  const sentAsk = useRef(false);
  useEffect(() => {
    if (!ask || sentAsk.current) return;
    sentAsk.current = true;
    void send(ask);
  }, [ask, send]);

  // Reopening reads what landed while it was minimised (and clears the + dot), or retries a failed load.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current && (conversation || loadError)) void reload();
    wasOpen.current = open;
  }, [open, conversation, loadError, reload]);

  const expand = () => {
    if (!conversation) return;
    onMinimize();
    router.push(`/assistant/${conversation.id}`);
  };

  // The header's chats button swaps the thread for the list of chats; picking one opens it here.
  const [showChats, setShowChats] = useState(false);
  const pick = (id: string) => {
    setShowChats(false);
    if (id !== conversation?.id) openAssistantPopup({ conversationId: id });
  };
  const allChats = () => {
    onMinimize();
    router.push("/assistant");
  };

  const title = showChats ? "Chats" : conversation ? conversationTitle(conversation) : target.id === "new" ? "Ask Rooftap" : "";
  const iconButton =
    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground";

  return (
    <PopupSurface open={open} onMinimize={onMinimize} title={title || "Rooftap"}>
      <div className="flex items-center gap-1 pl-4 pr-1.5">
        <p className="min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</p>
        <button
          type="button"
          onClick={() => setShowChats((v) => !v)}
          aria-label={showChats ? "Back to this chat" : "Your chats"}
          aria-pressed={showChats}
          className={cn(iconButton, showChats && "bg-muted text-foreground")}
        >
          <MessagesSquare className="h-4.5 w-4.5" />
        </button>
        <button type="button" onClick={onFresh} aria-label="New quick ask" className={iconButton}>
          <SquarePen className="h-4.5 w-4.5" />
        </button>
        {!showChats && conversation && conversation.kind !== "household" && (
          <button
            type="button"
            onClick={() => void thread.remove().then((gone) => gone && onFresh())}
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
      {showChats ? (
        <PopupChats currentId={conversation?.id ?? null} onPick={pick} onAll={allChats} />
      ) : (
        <>
          <ThreadMessages thread={thread} className="min-h-0 flex-1 overflow-y-auto px-4" />
          <ThreadFooter thread={thread} offline={!isOnline} autoFocus={target.id === "new" && !ask} onFresh={onFresh} className="px-3 pb-3" />
        </>
      )}
    </PopupSurface>
  );
}

/** How many closed quick asks the pop-up lists; the Assistant space has the rest. */
const EARLIER_SHOWN = 6;

/**
 * The pop-up's list of chats: the Household thread, kept chats, open quick
 * asks and the latest closed ones, the same rows as the Assistant space.
 * Paints from the cache at once and refreshes from the server.
 */
function PopupChats({ currentId, onPick, onAll }: { currentId: string | null; onPick: (id: string) => void; onAll: () => void }) {
  const [list, setList] = useState(() => cachedConversations());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    assistantApi
      .conversations()
      .then((rows) => {
        setList(rows);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your chats."));
  }, []);
  const groups = groupConversations(list);
  const sections = [
    { label: "Chats", rows: [...(groups.household ? [groups.household] : []), ...groups.chats] },
    { label: "Quick asks", rows: groups.open },
    { label: "Earlier", rows: groups.earlier.slice(0, EARLIER_SHOWN) },
  ].filter((section) => section.rows.length > 0);
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
              <ConversationRow key={c.id} conversation={c} current={c.id === currentId} onSelect={() => onPick(c.id)} />
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
function PopupSurface({ open, onMinimize, title, children }: { open: boolean; onMinimize: () => void; title: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const keyboardInset = useKeyboardInset(open);

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
    <div className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="Minimise"
        tabIndex={-1}
        onClick={onMinimize}
        className={cn(
          "absolute inset-0 bg-black/40 transition-opacity duration-[var(--motion-base)] md:bg-black/10",
          shown ? "opacity-100" : "opacity-0"
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
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
          "absolute inset-x-2.5 bottom-[calc(env(safe-area-inset-bottom)+0.625rem)] flex h-[min(74dvh,680px)] flex-col overflow-hidden rounded-[28px] border border-border/60 bg-popover shadow-[var(--card-shadow)]",
          "origin-bottom md:inset-x-auto md:bottom-6 md:right-6 md:w-[420px] md:origin-bottom-right",
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
