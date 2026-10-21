// Themed confirm/prompt queue shared by both apps. Replaces the stock
// platform dialogs (React Native's Alert.alert on mobile, window.confirm and
// window.prompt on web), which render in the OS's own chrome and ignore the
// Hearth theme. A plain pub-sub singleton, like @homeup/ui's toast store, so
// call sites can ask from any handler with no hook plumbing; each app mounts
// one host that renders the head of the queue (@homeup/ui `DialogHost` on
// native, apps/web's `DialogHost` on web).
//
// `dialog.alert` keeps Alert.alert's (title, message, buttons) shape so
// mobile call sites change only their callee; `confirm` and `prompt` return
// promises for the `if (!confirm(...)) return` shape web code uses.

export type DialogButtonStyle = 'default' | 'cancel' | 'destructive';

export interface DialogButton {
  text: string;
  /** 'cancel' also answers a dismiss (scrim tap, back button, Escape). 'destructive' draws in the danger hue. */
  style?: DialogButtonStyle;
  /** For a prompt dialog, receives the field's current text. */
  onPress?: (value: string) => void;
}

export interface DialogInput {
  defaultValue?: string;
  placeholder?: string;
}

export interface DialogEntry {
  id: string;
  title: string;
  message?: string;
  buttons: DialogButton[];
  /** Present on a prompt: the dialog shows a text field. */
  input?: DialogInput;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Default "Delete" when destructive, otherwise "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  /** Default "Save". */
  confirmLabel?: string;
  cancelLabel?: string;
}

let dialogs: DialogEntry[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function push(title: string, message: string | undefined, buttons: DialogButton[] | undefined, input?: DialogInput): string {
  const id = `dialog-${++nextId}`;
  dialogs = [
    ...dialogs,
    { id, title, message, buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }], input },
  ];
  emit();
  return id;
}

/**
 * Closes a dialog and runs the chosen button's handler. `buttonIndex` null is
 * a dismiss: it runs the cancel button's handler, if the dialog has one, so a
 * promise built on the buttons always settles. Safe to call more than once.
 */
export function resolveDialog(id: string, buttonIndex: number | null, value = ''): void {
  const entry = dialogs.find((d) => d.id === id);
  if (!entry) return;
  dialogs = dialogs.filter((d) => d.id !== id);
  emit();
  const button = buttonIndex == null ? entry.buttons.find((b) => b.style === 'cancel') : entry.buttons[buttonIndex];
  button?.onPress?.(value);
}

export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDialogs(): DialogEntry[] {
  return dialogs;
}

/** True when a dialog has a destructive button: hosts fire warn() as it appears. */
export function isDestructiveDialog(entry: DialogEntry): boolean {
  return entry.buttons.some((b) => b.style === 'destructive');
}

export const dialog = {
  /** Alert.alert's shape. With no buttons it shows a single OK. */
  alert(title: string, message?: string, buttons?: DialogButton[]): string {
    return push(title, message, buttons);
  },

  /** Resolves true on the confirm button, false on cancel or dismiss. */
  confirm({ title, message, confirmLabel, cancelLabel = 'Cancel', destructive = false }: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      push(title, message, [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        {
          text: confirmLabel ?? (destructive ? 'Delete' : 'OK'),
          style: destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ]);
    });
  },

  /** Resolves the entered text on confirm, null on cancel or dismiss. */
  prompt({ title, message, defaultValue, placeholder, confirmLabel = 'Save', cancelLabel = 'Cancel' }: PromptOptions): Promise<string | null> {
    return new Promise((resolve) => {
      push(
        title,
        message,
        [
          { text: cancelLabel, style: 'cancel', onPress: () => resolve(null) },
          { text: confirmLabel, onPress: (value) => resolve(value) },
        ],
        { defaultValue, placeholder }
      );
    });
  },
};
