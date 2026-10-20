// HOUP-91: native port of apps/web/src/components/ui/tag-input.tsx. A
// lightweight chip tag input with autocomplete from a supplied suggestion
// list. Tags are kept lowercase; Enter/comma commits, Backspace on an empty
// field removes the last chip.
//
// The web version tracks "focus left the whole component" via a container
// `onBlur` + `e.relatedTarget` check — RN has no DOM focus-bubbling or
// `relatedTarget`, so this re-expresses that as a short delayed-close timer
// on the TextInput's `onBlur`, cancelled if a suggestion is tapped before the
// timer fires or the input regains focus first.
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { Input } from './input';
import { Pill, pillTextVariants, pillTextStyle } from './pill';

const BLUR_CLOSE_DELAY_MS = 150;

export interface TagInputProps {
  tags: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
}

export function TagInput({ tags, onChange, suggestions, placeholder = 'Add tags…', className }: TagInputProps) {
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const norm = input.trim().toLowerCase();
  const available = suggestions.filter((s) => !tags.includes(s));
  const matches = norm
    ? available.filter((s) => s.includes(norm)).slice(0, 6)
    : focused
      ? available.slice(0, 6)
      : [];

  const add = (raw: string) => {
    const v = raw.trim().toLowerCase();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setInput('');
  };

  const cancelBlurTimer = () => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
  };

  return (
    <View className={className}>
      <View className="flex-row flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 py-1.5">
        {tags.map((t) => (
          <Pill key={t} variant="primary">
            <Text className={pillTextVariants({ variant: 'primary' })} style={pillTextStyle}>
              {t}
            </Text>
            <Pressable onPress={() => onChange(tags.filter((x) => x !== t))} accessibilityLabel={`Remove ${t}`} hitSlop={6}>
              <X size={12} className="text-primary" />
            </Pressable>
          </Pill>
        ))}
        <Input
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => add(input)}
          onKeyPress={({ nativeEvent }) => {
            if (nativeEvent.key === ',') add(input);
            else if (nativeEvent.key === 'Backspace' && !input && tags.length) onChange(tags.slice(0, -1));
          }}
          onFocus={() => {
            cancelBlurTimer();
            setFocused(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setFocused(false), BLUR_CLOSE_DELAY_MS);
          }}
          placeholder={tags.length ? '' : placeholder}
          className="h-6 min-w-24 flex-1 border-0 px-0.5 py-0"
        />
      </View>
      {focused && matches.length > 0 && (
        <View className="mt-1 flex-row flex-wrap gap-1.5">
          {matches.map((s) => (
            <Pressable
              key={s}
              onPress={() => {
                cancelBlurTimer();
                add(s);
              }}
              className="rounded-full border border-dashed border-border px-2 py-0.5"
            >
              <Text className="text-[0.65rem] text-muted-foreground">{s}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
