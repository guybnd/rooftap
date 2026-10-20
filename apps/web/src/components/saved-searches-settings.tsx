"use client";

import { useState } from "react";
import { Bookmark, Plus, Trash2, ExternalLink } from "lucide-react";
import { use$ } from "@legendapp/state/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormSection, FieldRow } from "@/components/ui/item-form-sheet";
import { SettingsInset, SettingsPanel } from "@/components/settings-panel";

/** The row's meta: "realestate.com.au", not the whole query URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
import { useDataCache } from "@/lib/data-cache";
import { savedSearches$, useReconnectSync, useStoreHelpers } from "@homeup/core";
import type { SavedSearch } from '@homeup/core';

export function SavedSearchesSettings() {
  const { group, currentUserId } = useDataCache();
  const searches$ = savedSearches$(group?.id);
  useReconnectSync(searches$);
  const { writeRow, softDeleteRow } = useStoreHelpers(searches$, currentUserId);
  const savedSearches = use$(() =>
    Object.values(searches$.get() ?? {}).filter((s): s is SavedSearch => !!s && !s.deleted)
  );
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!name.trim() || !url.trim() || !group || !currentUserId) return;
    setSaving(true);

    writeRow({
      id: crypto.randomUUID(),
      group_id: group.id,
      created_by: currentUserId,
      name: name.trim(),
      url: url.trim(),
      deleted: false,
      created_at: null as unknown as string,
      updated_at: null as unknown as string,
    });

    setName("");
    setUrl("");
    setAdding(false);
    setSaving(false);
  };

  const handleRemove = (id: string) => {
    softDeleteRow(id);
  };

  return (
    <SettingsPanel
      icon={Bookmark}
      title="Saved searches"
      description="Listing searches everyone in the household can check for new places."
    >
      {savedSearches.length > 0 && (
        <SettingsInset>
          {savedSearches.map((s) => (
            <div key={s.id} className="flex min-h-[52px] items-center gap-1 pr-2">
              {/* The row opens the search; remove is the one trailing verb. */}
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 px-3.5 py-2.5 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <span className="truncate">{s.name}</span>
                  <ExternalLink aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{hostOf(s.url)}</span>
              </a>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => handleRemove(s.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${s.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </SettingsInset>
      )}

      {adding ? (
        <div className="space-y-3">
          <FormSection>
            <FieldRow label="Name" htmlFor="saved-search-name">
              <Input
                id="saved-search-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Inner West 2BR under $600"
                className="h-9"
                autoFocus
              />
            </FieldRow>
            <FieldRow label="Link" htmlFor="saved-search-url">
              <Input
                id="saved-search-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.realestate.com.au/rent/..."
                className="h-9"
              />
            </FieldRow>
          </FormSection>
          <div className="flex items-center gap-2">
            <Button size="lg" className="px-3" onClick={handleAdd} disabled={!name.trim() || !url.trim() || saving}>
              {saving ? "Saving…" : "Save search"}
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="px-3"
              onClick={() => { setAdding(false); setName(""); setUrl(""); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="lg" variant="outline" className="px-3" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />
          Add saved search
        </Button>
      )}
    </SettingsPanel>
  );
}
