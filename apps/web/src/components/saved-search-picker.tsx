"use client";

import { useState, useEffect, useRef } from "react";
import { Search, ChevronDown, ExternalLink, Settings } from "lucide-react";
import Link from "next/link";
import { use$ } from "@legendapp/state/react";
import { useDataCache } from "@/lib/data-cache";
import { savedSearches$, useReconnectSync } from "@homeup/core";
import type { SavedSearch } from '@homeup/core';

export function SavedSearchPicker() {
  const { group } = useDataCache();
  const searches$ = savedSearches$(group?.id);
  useReconnectSync(searches$);
  const savedSearches = use$(() =>
    Object.values(searches$.get() ?? {}).filter((s): s is SavedSearch => !!s && !s.deleted)
  );
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  if (savedSearches.length === 0) {
    return (
      <Link
        href="/settings"
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-card/70 px-3.5 text-sm font-medium text-foreground hover:bg-muted/60 transition-colors"
      >
        <Search className="h-4 w-4 text-muted-foreground" />
        <span>Find more apartments</span>
        <Settings className="h-3.5 w-3.5 text-muted-foreground/60" />
      </Link>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-card/70 px-3.5 text-sm font-medium text-foreground hover:bg-muted/60 aria-expanded:bg-muted/60 transition-colors"
      >
        <Search className="h-4 w-4 text-muted-foreground" />
        Find more apartments
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 sm:left-auto sm:right-0 mt-2 z-50 min-w-[260px] max-w-[360px] rounded-xl bg-popover border border-border/60 shadow-xl shadow-black/20 p-1.5 animate-in fade-in-0 zoom-in-95 slide-in-from-top-1">
          <div className="px-2.5 py-2 mb-0.5">
            <p className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.1em]">Saved searches</p>
          </div>
          {savedSearches.map((s) => (
            <a
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-muted/60 transition-colors group"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate group-hover:text-foreground">{s.name}</p>
                <p className="text-[11px] text-muted-foreground/50 truncate">
                  {(() => { try { return new URL(s.url).hostname; } catch { return s.url; } })()}
                </p>
              </div>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 ml-2 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
            </a>
          ))}
          <div className="border-t border-border/40 mt-1 pt-1">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <Settings className="h-3 w-3" />
              Manage searches
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
