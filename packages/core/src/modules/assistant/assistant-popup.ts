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
