"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { createSetupStore, deleteSetupStore, listSetupStores, updateSetupStore, type SetupStore } from '@homeup/core';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SettingsInset, SettingsPanel } from "@/components/settings-panel";
import { Store, Plus, ExternalLink } from "lucide-react";

/** "https://www.bunnings.com.au/x" -> "bunnings.com.au": the row's meta, not the raw URL. */
function linkLabel(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * FLUX-65 (Home Setup): manage the household's stores — name + optional link
 * and address. Backed by the existing group-scoped setup_stores table (shared
 * across the group), which also powers the per-item store picker in Setup.
 */
export function SetupStoresSettings() {
  const { group } = useDataCache();
  const [stores, setStores] = useState<SetupStore[]>([]);
  const [loading, setLoading] = useState(true);

  // Add form
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [address, setAddress] = useState("");
  const [adding, setAdding] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchStores = useCallback(async () => {
    if (!group?.id) return;
    setStores(await listSetupStores(createClient(), group.id));
    setLoading(false);
  }, [group?.id]);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  const addStore = async () => {
    const trimmed = name.trim();
    if (!trimmed || !group?.id) return;
    setAdding(true);
    try {
      await createSetupStore(createClient(), group.id, { name: trimmed, url, address });
      setName("");
      setUrl("");
      setAddress("");
      setAddOpen(false);
      await fetchStores();
    } catch (err) {
      console.error("Failed to add store:", err);
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (s: SetupStore) => {
    setEditingId(s.id);
    setEditName(s.name);
    setEditUrl(s.url ?? "");
    setEditAddress(s.address ?? "");
  };

  const saveEdit = async () => {
    const trimmed = editName.trim();
    if (!trimmed || !editingId) return;
    setSavingEdit(true);
    try {
      await updateSetupStore(createClient(), editingId, { name: trimmed, url: editUrl, address: editAddress });
      setEditingId(null);
      await fetchStores();
    } finally {
      setSavingEdit(false);
    }
  };

  const removeStore = async (id: string) => {
    await deleteSetupStore(createClient(), id);
    setEditingId(null);
    await fetchStores();
  };

  // The add form opens on demand once there are stores; with none it is the
  // panel's whole point, so it starts open.
  const showAddForm = addOpen || (!loading && stores.length === 0);

  return (
    <SettingsPanel
      icon={Store}
      title="Stores"
      description="Where your household buys things for the home. Setup items can be tagged with these."
    >
      {!loading && stores.length > 0 && (
        <SettingsInset>
          {stores.map((s) =>
            editingId === s.id ? (
              <div key={s.id} className="space-y-2 p-3">
                <Input
                  placeholder="Store name"
                  aria-label="Store name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-9"
                  autoFocus
                />
                <Input
                  placeholder="Link (optional)"
                  aria-label="Link"
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  className="h-9"
                />
                <Input
                  placeholder="Address (optional)"
                  aria-label="Address"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="h-9"
                />
                <div className="flex items-center gap-2 pt-1">
                  <Button size="lg" className="px-3" onClick={saveEdit} disabled={savingEdit || !editName.trim()}>
                    Save
                  </Button>
                  <Button size="lg" variant="ghost" className="px-3" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                  {/* E4: destructive sits alone, danger text, no fill. */}
                  <Button
                    size="lg"
                    variant="ghost"
                    className="ml-auto px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => removeStore(s.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ) : (
              <div key={s.id} className="flex min-h-[52px] items-center gap-1 pr-2">
                {/* Tap the row to edit it (delete lives in the editor), the
                    same contract as the native list. */}
                <button
                  type="button"
                  onClick={() => startEdit(s)}
                  className="min-w-0 flex-1 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-label={`Edit ${s.name}`}
                >
                  <span className="block truncate text-sm font-medium text-foreground">{s.name}</span>
                  {(s.url || s.address) && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {[s.url ? linkLabel(s.url) : null, s.address].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </button>
                {s.url && (
                  <a
                    href={s.url.startsWith("http") ? s.url : `https://${s.url}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${s.name}'s site`}
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            )
          )}
        </SettingsInset>
      )}

      {showAddForm ? (
        <div className="space-y-2">
          <Input placeholder="Store name" aria-label="Store name" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
          <Input placeholder="Link (optional)" aria-label="Link" value={url} onChange={(e) => setUrl(e.target.value)} className="h-9" />
          <Input
            placeholder="Address (optional)"
            aria-label="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="h-9"
          />
          <div className="flex items-center gap-2 pt-1">
            <Button size="lg" className="px-3" onClick={addStore} disabled={adding || !name.trim() || !group?.id}>
              <Plus className="h-4 w-4" /> {adding ? "Adding…" : "Add store"}
            </Button>
            {stores.length > 0 && (
              <Button size="lg" variant="ghost" className="px-3" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button size="lg" variant="outline" className="px-3" onClick={() => setAddOpen(true)} disabled={!group?.id}>
          <Plus className="h-4 w-4" /> Add store
        </Button>
      )}
    </SettingsPanel>
  );
}
