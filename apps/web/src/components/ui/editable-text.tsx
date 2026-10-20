'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EditableTextProps {
  /** Current committed value (as a string — callers own their own parsing/formatting). */
  value: string;
  /** Called with the new value when the edit should be persisted. */
  onCommit: (value: string) => void;
  /** Controlled editing state — lets a caller start an edit from elsewhere (e.g. a menu
   *  item on an otherwise-empty field). Falls back to internal state when omitted. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** Decides whether a blur/Enter should actually call `onCommit`. Default: `next !== prev`
   *  (raw string inequality — matches this codebase's existing inline-edit fields). Override
   *  for e.g. numeric fields where the edited string and the committed value differ in shape. */
  hasChanged?: (next: string, prev: string) => boolean;
  /** Textarea instead of input — Enter inserts a newline rather than committing. */
  multiline?: boolean;
  /** `<input type>` when not multiline. */
  type?: string;
  /** `<input inputMode>` — e.g. `"decimal"` for a numeric field kept as `type="text"` so free-form entry (partial decimals) isn't fought by the browser's `type="number"` parsing. */
  inputMode?: 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url' | 'none';
  rows?: number;
  placeholder?: string;
  /** Select the current text once the field enters edit mode. Default true. */
  autoSelect?: boolean;
  /** Trigger content shown when not editing. Defaults to the raw `value`. */
  children?: ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
  inputClassName?: string;
}

const defaultHasChanged = (next: string, prev: string) => next !== prev;

/**
 * Click-to-edit text: a clickable trigger that swaps to an input/textarea on click,
 * generalized out of the inline-edit state machine triplicated across the tasks/costs/
 * setup cards. Enter commits (single-line only), Escape cancels, blur commits only if
 * `hasChanged`, and focus returns to the trigger once editing closes either way.
 */
export function EditableText({
  value,
  onCommit,
  editing: editingProp,
  onEditingChange,
  hasChanged = defaultHasChanged,
  multiline = false,
  type = 'text',
  inputMode,
  rows = 2,
  placeholder,
  autoSelect = true,
  children,
  triggerClassName,
  triggerTitle,
  inputClassName,
}: EditableTextProps) {
  const isControlled = editingProp !== undefined;
  const [internalEditing, setInternalEditing] = useState(false);
  const editing = isControlled ? editingProp : internalEditing;

  const setEditing = (next: boolean) => {
    if (!isControlled) setInternalEditing(next);
    onEditingChange?.(next);
  };

  const [draft, setDraft] = useState(value);
  const pendingActionRef = useRef<'commit' | 'cancel' | null>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const wasEditingRef = useRef(editing);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      inputRef.current?.focus();
      if (autoSelect) inputRef.current?.select?.();
    }
    // Only reset the draft when an edit session STARTS, not on every value change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  useEffect(() => {
    if (wasEditingRef.current && !editing) triggerRef.current?.focus();
    wasEditingRef.current = editing;
  }, [editing]);

  const startEditing = () => setEditing(true);

  const closeEditing = (commit: boolean) => {
    setEditing(false);
    if (commit && hasChanged(draft, value)) onCommit(draft);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      pendingActionRef.current = 'cancel';
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'Enter' && !multiline) {
      pendingActionRef.current = 'commit';
      e.currentTarget.blur();
    }
  };

  const handleBlur = () => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    closeEditing(action !== 'cancel');
  };

  if (editing) {
    const commonProps = {
      ref: inputRef,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(e.target.value),
      onKeyDown: handleKeyDown,
      onBlur: handleBlur,
      placeholder,
      inputMode,
      className: inputClassName,
    };
    return multiline ? (
      <textarea rows={rows} {...commonProps} />
    ) : (
      <input type={type} {...commonProps} />
    );
  }

  return (
    <span
      ref={triggerRef}
      role="button"
      tabIndex={0}
      onClick={startEditing}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          startEditing();
        }
      }}
      className={cn('cursor-pointer', triggerClassName)}
      title={triggerTitle}
    >
      {children ?? value}
    </span>
  );
}
