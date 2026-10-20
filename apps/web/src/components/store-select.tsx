'use client';

import { useState, useRef, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { createSetupStore, type SetupStore } from '@homeup/core';

interface StoreSelectProps {
  groupId: string;
  value: string | null;
  stores: SetupStore[];
  onChange: (storeId: string | null) => void;
  onStoreCreated?: (store: SetupStore) => void;
  /** compact = inline pill style for cards; full = form field style for the modal */
  variant?: 'compact' | 'full';
}

export function StoreSelect({
  groupId,
  value,
  stores,
  onChange,
  onStoreCreated,
  variant = 'compact',
}: StoreSelectProps) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  const createStore = async () => {
    const name = newName.trim();
    if (!name) {
      setAdding(false);
      return;
    }
    setSaving(true);
    try {
      // Reuse an existing store with the same name if present
      const existing = stores.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        onChange(existing.id);
        setAdding(false);
        setNewName('');
        return;
      }

      const data = await createSetupStore(createClient(), groupId, { name });
      onStoreCreated?.(data);
      onChange(data.id);
      setAdding(false);
      setNewName('');
    } catch (err) {
      console.error('Failed to create store:', err);
    } finally {
      setSaving(false);
    }
  };

  if (adding) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') createStore();
            if (e.key === 'Escape') {
              setAdding(false);
              setNewName('');
            }
          }}
          onBlur={createStore}
          placeholder="Store name"
          disabled={saving}
          className={
            variant === 'full'
              ? 'rounded bg-input border border-border px-3 py-2 text-foreground text-sm w-full'
              : 'rounded bg-muted border border-border px-2 py-0.5 text-foreground text-xs w-28'
          }
        />
      </span>
    );
  }

  return (
    <select
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === '__add__') {
          setAdding(true);
        } else {
          onChange(e.target.value || null);
        }
      }}
      className={
        variant === 'full'
          ? 'w-full rounded bg-input border border-border px-3 py-2 text-foreground'
          : // Sized to the chosen store, not the longest option, with no
            // browser chevron: the store glyph beside it marks the control.
            `field-sizing-content max-w-full appearance-none truncate bg-transparent hover:text-primary cursor-pointer text-xs border-0 p-0 focus:outline-none ${
              value ? 'text-foreground' : 'text-muted-foreground'
            }`
      }
      aria-label="Store"
    >
      <option value="">No store</option>
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
      <option value="__add__">Add a store…</option>
    </select>
  );
}
