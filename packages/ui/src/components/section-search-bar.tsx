// HOUP-121: native port of apps/web/src/components/section-search-bar.tsx —
// reusable collapsible section search input, built on the shared `Input`
// primitive. First consumer is apps/mobile's Tasks screen; every future
// native section search should reuse this instead of a screen-local input.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { Input } from './input';
import { cn } from '../lib/cn';

export interface SectionSearchBarProps {
  value: string;
  onChange: (query: string) => void;
  /** Return key pressed with a non-empty query. The keyboard stays up so the
   *  next query can follow straight away. */
  onSubmit?: (query: string) => void;
  onFocusChange?: (focused: boolean) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function SectionSearchBar({
  value,
  onChange,
  onSubmit,
  onFocusChange,
  placeholder = 'Search…',
  autoFocus = false,
  className,
}: SectionSearchBarProps) {
  return (
    <View className={cn('relative flex-row items-center', className)}>
      <Search size={14} className="absolute left-3 top-1/2 z-10 -mt-[7px] text-muted-foreground/50" />
      <Input
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType={onSubmit ? 'done' : 'search'}
        onSubmitEditing={onSubmit ? () => value.trim() && onSubmit(value) : undefined}
        submitBehavior={onSubmit ? 'submit' : undefined}
        onFocus={onFocusChange ? () => onFocusChange(true) : undefined}
        onBlur={onFocusChange ? () => onFocusChange(false) : undefined}
        className="h-10 flex-1 bg-muted/40 pl-9 pr-9"
      />
      {!!value && (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          className="absolute right-2.5 top-1/2 z-10 -mt-3 h-6 w-6 items-center justify-center rounded-full bg-muted-foreground/20"
        >
          <X size={12} className="text-muted-foreground" />
        </Pressable>
      )}
    </View>
  );
}
