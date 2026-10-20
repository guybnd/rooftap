// HOUP-120: native port of apps/web/src/components/ui/editable-text.tsx — a
// tap-to-edit trigger (despite the web file's name, neither side uses DOM
// contentEditable; it's a plain controlled input swapped in for a display
// span/Text). RN has no Escape-to-cancel affordance on a touch keyboard, so
// that web escape hatch is dropped; blur and submit both always commit (if
// changed), matching the trigger's only realistic dismiss path on mobile.
import * as React from 'react';
import { Pressable, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { cn } from '../lib/cn';

export interface EditableTextProps {
  value: string;
  onCommit: (value: string) => void;
  /** Controlled editing state — omit to let the component own it internally. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** Default: next !== prev. */
  hasChanged?: (next: string, prev: string) => boolean;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  /** Select all text when editing starts. Default true. */
  autoSelect?: boolean;
  /** Trigger display content — default is the raw value. */
  children?: React.ReactNode;
  triggerClassName?: string;
  inputClassName?: string;
  keyboardType?: KeyboardTypeOptions;
  accessibilityLabel?: string;
}

const defaultHasChanged = (next: string, prev: string) => next !== prev;

export function EditableText({
  value,
  onCommit,
  editing: editingProp,
  onEditingChange,
  hasChanged = defaultHasChanged,
  multiline = false,
  rows = 2,
  placeholder,
  autoSelect = true,
  children,
  triggerClassName,
  inputClassName,
  keyboardType,
  accessibilityLabel,
}: EditableTextProps) {
  const isControlled = editingProp !== undefined;
  const [internalEditing, setInternalEditing] = React.useState(false);
  const editing = isControlled ? editingProp : internalEditing;
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<TextInput>(null);

  const setEditing = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalEditing(next);
      onEditingChange?.(next);
    },
    [isControlled, onEditingChange]
  );

  // Only reset the draft when an edit session STARTS, not on every value
  // change — matches web's deliberate `[editing]`-only effect dependency.
  React.useEffect(() => {
    if (!editing) return;
    setDraft(value);
    const t = setTimeout(() => {
      inputRef.current?.focus();
      if (autoSelect) inputRef.current?.setSelection?.(0, value.length);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const startEditing = () => setEditing(true);

  const closeEditing = (commit: boolean) => {
    setEditing(false);
    if (commit && hasChanged(draft, value)) onCommit(draft);
  };

  if (editing) {
    return (
      <TextInput
        ref={inputRef}
        value={draft}
        onChangeText={setDraft}
        onBlur={() => closeEditing(true)}
        onSubmitEditing={() => {
          if (!multiline) closeEditing(true);
        }}
        multiline={multiline}
        numberOfLines={multiline ? rows : undefined}
        placeholder={placeholder}
        keyboardType={keyboardType}
        autoFocus
        selectTextOnFocus={autoSelect}
        accessibilityLabel={accessibilityLabel}
        textAlignVertical={multiline ? 'top' : undefined}
        className={cn(
          'rounded-md border border-ring bg-background px-2 py-1 text-body text-foreground',
          multiline && 'min-h-16',
          inputClassName
        )}
      />
    );
  }

  return (
    <Pressable
      onPress={startEditing}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      className={triggerClassName}
    >
      {children ?? (
        <View className="min-w-0">
          <Text numberOfLines={multiline ? rows : 1} className="text-body text-foreground">
            {value || placeholder}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
