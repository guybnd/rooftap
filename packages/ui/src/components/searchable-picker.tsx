// HOUP-91: native port of apps/web/src/components/ui/searchable-picker.tsx.
// A generic searchable, categorised "pick one of many" field: search box,
// Recent pin, grouped headers. Web opens a DOM popover with keyboard nav
// (↑/↓/Enter/Esc) and a `document` outside-click listener; native has no
// keyboard-nav surface worth porting (touch-select only) and no DOM to
// listen on, so the trigger opens a native `BottomSheet` instead — its own
// backdrop press/hardware-back already covers "dismiss without picking".
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check, ChevronsUpDown, Search } from 'lucide-react-native';
import type { PickerOption } from '@homeup/core';
import { cn } from '../lib/cn';
import { select } from '../lib/haptics';
import { Input } from './input';
import { BottomSheet } from './bottom-sheet';
import { BottomSheetScrollView } from './bottom-sheet-scroll-view';

export type { PickerOption };

export interface SearchablePickerProps {
  options: PickerOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Pin the top N options (in input order) under a "Recent" header when not searching. */
  recentCount?: number;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

interface Section {
  header: { label: string; color?: string } | null;
  options: PickerOption[];
}

function matches(opt: PickerOption, q: string): boolean {
  const hay = `${opt.primary} ${opt.secondary ?? ''} ${opt.searchText ?? ''}`.toLowerCase();
  return hay.includes(q);
}

export function SearchablePicker({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches',
  recentCount = 0,
  disabled = false,
  className,
  ariaLabel,
}: SearchablePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  const sections = useMemo((): Section[] => {
    const q = query.trim().toLowerCase();
    if (q) {
      return [{ header: null, options: options.filter((o) => matches(o, q)) }];
    }

    const out: Section[] = [];
    let rest = options;
    if (recentCount > 0 && options.length > recentCount) {
      out.push({ header: { label: 'Recent' }, options: options.slice(0, recentCount) });
      rest = options.slice(recentCount);
    }

    const grouped = new Map<string, Section>();
    const order: string[] = [];
    for (const o of rest) {
      const key = o.group?.key ?? '__none';
      if (!grouped.has(key)) {
        grouped.set(key, {
          header: o.group ? { label: o.group.label, color: o.group.color } : null,
          options: [],
        });
        order.push(key);
      }
      grouped.get(key)!.options.push(o);
    }
    for (const key of order) out.push(grouped.get(key)!);
    return out;
  }, [options, query, recentCount]);

  const flatCount = sections.reduce((n, s) => n + s.options.length, 0);

  const choose = useCallback(
    (val: string) => {
      select();
      onChange(val);
      setOpen(false);
      setQuery('');
    },
    [onChange]
  );

  return (
    <View className={cn('relative', className)}>
      <Pressable
        disabled={disabled}
        accessibilityLabel={ariaLabel}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        className="h-8 flex-row items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 disabled:opacity-50"
      >
        <Text numberOfLines={1} className={cn('flex-1 text-body', selected ? 'text-foreground' : 'text-muted-foreground')}>
          {selected ? selected.primary : placeholder}
        </Text>
        <ChevronsUpDown size={16} className="shrink-0 text-muted-foreground" />
      </Pressable>

      <BottomSheet
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery('');
        }}
        className="max-h-[75%]"
      >
        <View className="flex-row items-center gap-2 border-b border-border px-4 pb-3">
          <Search size={16} className="shrink-0 text-muted-foreground" />
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
            autoFocus
            className="h-8 flex-1 border-0 px-0"
          />
        </View>

        <BottomSheetScrollView className="max-h-96 px-2 py-1">
          {flatCount === 0 ? (
            <Text className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</Text>
          ) : (
            sections.map((section, si) => (
              <View key={si}>
                {section.header && (
                  <View className="flex-row items-center gap-1.5 px-2 pb-1 pt-2">
                    {section.header.color && (
                      <View className={cn('h-2 w-2 rounded-full', section.header.color)} />
                    )}
                    <Text className="text-micro-label uppercase text-muted-foreground">
                      {section.header.label}
                    </Text>
                  </View>
                )}
                {section.options.map((opt) => {
                  const isSelected = opt.value === value;
                  return (
                    <Pressable
                      key={opt.value}
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => choose(opt.value)}
                      className="flex-row items-center justify-between gap-2 rounded-lg px-2 py-2"
                    >
                      <View className="min-w-0 flex-1">
                        <Text numberOfLines={1} className="text-body text-foreground">
                          {opt.primary}
                        </Text>
                        {opt.secondary && (
                          <Text numberOfLines={1} className="text-xs text-muted-foreground">
                            {opt.secondary}
                          </Text>
                        )}
                      </View>
                      {isSelected && <Check size={16} className="shrink-0 text-primary" />}
                    </Pressable>
                  );
                })}
              </View>
            ))
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}
