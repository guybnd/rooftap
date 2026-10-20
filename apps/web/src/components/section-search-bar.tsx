'use client';

import { Search } from 'lucide-react';

// FLUX-110: reusable section search input. Layout lifted from the dashboard
// search (icon left, type=text input, clear button right when non-empty) so
// every section's search bar looks and behaves the same.
export function SectionSearchBar({
  value,
  onChange,
  onSubmit,
  onFocusChange,
  placeholder = 'Search…',
  className = '',
  autoFocus = false,
}: {
  value: string;
  onChange: (q: string) => void;
  /** Enter pressed with a non-empty query. */
  onSubmit?: (q: string) => void;
  onFocusChange?: (focused: boolean) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={`relative flex-1 min-w-0 max-w-sm ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
      <input
        type="text"
        role="searchbox"
        inputMode="search"
        enterKeyHint={onSubmit ? 'done' : 'search'}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocusChange ? () => onFocusChange(true) : undefined}
        onBlur={onFocusChange ? () => onFocusChange(false) : undefined}
        onKeyDown={onSubmit ? (e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && value.trim()) {
            e.preventDefault();
            onSubmit(value);
          }
        } : undefined}
        className="w-full rounded-lg bg-muted/40 border border-white/[0.03] px-9 py-2 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring/20 focus:bg-muted/60 transition-all duration-150"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-muted-foreground/20 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors text-[10px]"
          aria-label="Clear search"
        >
          &times;
        </button>
      )}
    </div>
  );
}
