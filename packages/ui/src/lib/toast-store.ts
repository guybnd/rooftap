// HOUP-139: universal toast queue — a plain pub-sub singleton (not a Legend
// store) so call sites can fire `toast.success('...')` from anywhere
// (handlers, not just components) exactly like apps/web's `sonner` import,
// with zero hook plumbing. `components/toast.tsx`'s `ToastHost` is the only
// subscriber, via `useSyncExternalStore`.

export type ToastVariant = 'default' | 'success' | 'error';

/** Which edge of the screen a toast stacks against. */
export type ToastPlacement = 'top' | 'bottom';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastOptions {
  description?: string;
  /** Auto-dismiss delay in ms. Default 4000; the web "item added" pill uses 5000. */
  duration?: number;
  action?: ToastAction;
  /** Fires once the toast leaves, however it left (timeout, action tap, manual dismiss). */
  onDismiss?: () => void;
  /**
   * Default 'bottom', next to the content the user just acted on (Undo pills).
   * 'top' suits app-level notices not tied to a tap, like an update being ready.
   */
  placement?: ToastPlacement;
}

export interface ToastEntry {
  id: string;
  message: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
  action?: ToastAction;
  onDismiss?: () => void;
  placement: ToastPlacement;
}

const DEFAULT_DURATION_MS = 4000;

let toasts: ToastEntry[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function push(message: string, variant: ToastVariant, options?: ToastOptions): string {
  const id = `toast-${++nextId}`;
  toasts = [
    ...toasts,
    {
      id,
      message,
      description: options?.description,
      variant,
      duration: options?.duration ?? DEFAULT_DURATION_MS,
      action: options?.action,
      onDismiss: options?.onDismiss,
      placement: options?.placement ?? 'bottom',
    },
  ];
  emit();
  return id;
}

/** Removes a toast by id and fires its `onDismiss`. Safe to call more than once. */
export function dismissToast(id: string): void {
  const entry = toasts.find((t) => t.id === id);
  if (!entry) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
  entry.onDismiss?.();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): ToastEntry[] {
  return toasts;
}

export const toast = {
  message: (message: string, options?: ToastOptions) => push(message, 'default', options),
  success: (message: string, options?: ToastOptions) => push(message, 'success', options),
  error: (message: string, options?: ToastOptions) => push(message, 'error', options),
};
