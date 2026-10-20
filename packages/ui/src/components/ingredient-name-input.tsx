// HOUP-91: native port of apps/web/src/components/ui/ingredient-name-input.tsx.
// A single-value text input with autocomplete suggestions — it holds a SINGLE
// free-text value (novel names always allowed) rather than a chip list, so
// typing an ingredient that already exists as a grocery item makes the
// have/need match land.
//
// Same delayed-blur pattern as TagInput (see tag-input.tsx) in place of the
// web version's container `onBlur` + `relatedTarget` check, which has no RN
// equivalent.
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { cn } from '../lib/cn';
import { Input } from './input';

const BLUR_CLOSE_DELAY_MS = 150;

export interface IngredientNameInputProps {
  value: string;
  onChange: (next: string) => void;
  /** Candidate names (grocery items + prior recipe ingredients), already deduped. */
  suggestions: string[];
  placeholder?: string;
  /** Optional per-suggestion annotation (e.g. current grocery status label). */
  annotate?: (name: string) => { label: string; className?: string } | null;
  autoFocus?: boolean;
  className?: string;
  onSubmitEditing?: () => void;
  returnKeyType?: 'done' | 'go' | 'next' | 'search' | 'send';
}

export function IngredientNameInput({
  value,
  onChange,
  suggestions,
  placeholder = 'Ingredient name…',
  annotate,
  autoFocus,
  className,
  onSubmitEditing,
  returnKeyType,
}: IngredientNameInputProps) {
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const q = value.trim().toLowerCase();

  const matches = (
    q ? suggestions.filter((s) => s.toLowerCase().includes(q)) : focused ? suggestions : []
  )
    .filter((s) => s.toLowerCase() !== q)
    .slice(0, 6);

  return (
    <View className={cn('relative', className)}>
      <Input
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        onChangeText={onChange}
        onFocus={() => {
          if (blurTimer.current) {
            clearTimeout(blurTimer.current);
            blurTimer.current = null;
          }
          setFocused(true);
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setFocused(false), BLUR_CLOSE_DELAY_MS);
        }}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        placeholder={placeholder}
      />
      {focused && matches.length > 0 && (
        <View className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-border bg-popover">
          {matches.map((s) => {
            const note = annotate?.(s) ?? null;
            return (
              <Pressable
                key={s}
                onPress={() => onChange(s)}
                className="flex-row items-center justify-between gap-2 px-3 py-2"
              >
                <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-popover-foreground">
                  {s}
                </Text>
                {note && (
                  <Text className={cn('shrink-0 text-xs', note.className ?? 'text-muted-foreground')}>
                    {note.label}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
