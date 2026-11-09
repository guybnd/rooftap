// Rooftap Assistant: the pop-up chat that grows out of the +. Anything can
// ask for it (the + itself, the capture sheet's Ask row, a tapped "Rooftap
// answered" banner or notification); the app's one popup host listens and
// opens. Without a host mounted, callers fall back to the full chat screen.

export interface AssistantPopupRequest {
  /** Open this conversation; leave out to resume the last one, or start fresh. */
  conversationId?: string;
  /** Start a new quick ask and send this at once. */
  ask?: string;
  /** Start a new quick ask even if one is open. */
  fresh?: boolean;
  /** Open a module helper's chat (module-helpers.ts), resuming this person's chat with it. */
  helper?: string;
  /** Plain Rooftap (from a helper): the last chat that was not a helper's, or a new quick ask. */
  plain?: boolean;
}

type PopupListener = (request: AssistantPopupRequest) => void;
const popupListeners = new Set<PopupListener>();

/** Opens the pop-up chat; false when no host is mounted (open the chat screen instead). */
export function openAssistantPopup(request: AssistantPopupRequest = {}): boolean {
  if (popupListeners.size === 0) return false;
  for (const listener of popupListeners) listener(request);
  return true;
}

export function onAssistantPopup(listener: PopupListener): () => void {
  popupListeners.add(listener);
  return () => {
    popupListeners.delete(listener);
  };
}

/** The conversation id in an `/assistant/<id>` link (a push's url), or null. */
export function assistantConversationFromUrl(url: string): string | null {
  const m = /^\/assistant\/([^/?#]+)\/?(?:[?#].*)?$/.exec(url);
  return m && m[1] !== 'new' ? decodeURIComponent(m[1]) : null;
}

/**
 * Where the chat bubble sits after a drag: the side it snapped to and how
 * far up from its home spot (px). Kept for the session, so a bubble that
 * comes back sits where it was left; web also keeps it in the browser.
 */
export type BubbleSpot = { side: 'left' | 'right'; lift: number };

let bubbleSpotNow: BubbleSpot = { side: 'right', lift: 0 };

export function bubbleSpot(): BubbleSpot {
  return bubbleSpotNow;
}

export function setBubbleSpot(spot: BubbleSpot): void {
  bubbleSpotNow = spot;
}

/**
 * Where a dragged bubble lands. `centerX` is the bubble's centre across a
 * screen `width` wide; it snaps to the nearer side. `lift` (px up from home)
 * stays within 0 and `maxLift`.
 */
export function snapBubble(centerX: number, width: number, lift: number, maxLift: number): BubbleSpot {
  return {
    side: centerX < width / 2 ? 'left' : 'right',
    lift: Math.round(Math.min(Math.max(lift, 0), Math.max(maxLift, 0))),
  };
}
