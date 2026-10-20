"use client";

// FLUX-114/121: a lightweight chip tag input with autocomplete from a supplied
// suggestion list. Tags are kept lowercase; Enter/comma commits, Backspace on an
// empty field removes the last chip. Shared by the capture details step and the
// documents edit modal.

import { useState } from "react";
import { X } from "lucide-react";

interface TagInputProps {
  tags: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  placeholder?: string;
}

export function TagInput({ tags, onChange, suggestions, placeholder = "Add tags…" }: TagInputProps) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const norm = input.trim().toLowerCase();
  // While typing, filter; on focus with no query, surface group tags so
  // autocomplete is discoverable (FLUX-123). Suggestions are alphabetical.
  const available = suggestions.filter((s) => !tags.includes(s));
  const matches = norm
    ? available.filter((s) => s.includes(norm)).slice(0, 6)
    : focused
      ? available.slice(0, 6)
      : [];

  const add = (raw: string) => {
    const v = raw.trim().toLowerCase();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setInput("");
  };

  return (
    // Track focus on the container so keyboard Tab between the input and the
    // suggestion buttons keeps the list open; it only closes when focus leaves
    // the component entirely (FLUX-123).
    <div
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false); }}
    >
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {t}
            <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="hover:text-destructive">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(input); }
            else if (e.key === "Backspace" && !input && tags.length) onChange(tags.slice(0, -1));
          }}
          placeholder={tags.length ? "" : placeholder}
          className="min-w-[6rem] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {matches.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {matches.map((s) => (
            // onMouseDown preventDefault keeps focus on the input (beating the
            // blur race for mouse users); onClick handles activation for both
            // mouse and keyboard (Tab→Enter), so suggestions stay accessible.
            <button key={s} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)} className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
