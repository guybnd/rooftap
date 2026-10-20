"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Check, X, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

function useOnClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    const listener = (e: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      handler();
    };
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler]);
}

interface InlineEditProps {
  value: string;
  onSave: (value: string) => Promise<void> | void;
  type?: "text" | "number" | "url" | "textarea";
  placeholder?: string;
  suffix?: string;
  prefix?: string;
  className?: string;
  displayClassName?: string;
  emptyText?: string;
  validate?: (value: string) => boolean;
}

export function InlineEdit({
  value,
  onSave,
  type = "text",
  placeholder,
  suffix,
  prefix,
  className,
  displayClassName,
  emptyText = "Click to add",
  validate,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback(() => {
    if (!editing || saving) return;
    if (draft === value) {
      setEditing(false);
    } else {
      // value changed — save on blur
      if (validate && !validate(draft)) {
        setDraft(value);
        setEditing(false);
      }
    }
  }, [editing, saving, draft, value, validate]);

  useOnClickOutside(containerRef, handleClickOutside);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const save = useCallback(async () => {
    if (validate && !validate(draft)) {
      setDraft(value);
      setEditing(false);
      return;
    }
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }, [draft, value, onSave, validate]);

  const cancel = useCallback(() => {
    setDraft(value);
    setEditing(false);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && type !== "textarea") {
        e.preventDefault();
        save();
      } else if (e.key === "Escape") {
        cancel();
      }
    },
    [save, cancel, type]
  );

  if (editing) {
    return (
      <div ref={containerRef} className={cn("flex items-center gap-1.5", className)}>
        {prefix && <span className="text-sm text-muted-foreground shrink-0">{prefix}</span>}
        {type === "textarea" ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            placeholder={placeholder}
            disabled={saving}
            className="w-full rounded-md border bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={type === "url" ? "url" : type === "number" ? "number" : "text"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={saving}
            className="h-9 w-full min-w-0 rounded-md border bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        )}
        {suffix && <span className="text-sm text-muted-foreground shrink-0">{suffix}</span>}
        <button
          onClick={save}
          disabled={saving}
          aria-label="Save"
          className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent text-foreground"
        >
          <Check className="size-4" />
        </button>
        <button
          onClick={cancel}
          disabled={saving}
          aria-label="Cancel"
          className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  const hasValue = value !== "" && value != null;

  return (
    <button
      onClick={() => setEditing(true)}
      className={cn(
        "group text-left w-full flex items-center gap-1 rounded-md transition-colors hover:bg-accent/50 -mx-1 px-1 py-0.5",
        displayClassName
      )}
    >
      {/* H6: value first, the unit in muted small type; the prefix ("$", "~")
          reads as part of the value. Empty reads as a quiet verb, not italics. */}
      <span className={cn(type !== "textarea" && "truncate", !hasValue && "text-muted-foreground text-sm font-normal")}>
        {hasValue ? `${prefix ?? ""}${value}` : emptyText}
      </span>
      {suffix && hasValue && <span className="text-sm font-normal text-muted-foreground">{suffix}</span>}
      <Pencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-auto" />
    </button>
  );
}
