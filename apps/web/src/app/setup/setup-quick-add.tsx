'use client';

import { useState } from 'react';
import { quickAddSetupItem, type SetupItem } from '@homeup/core';
import { Plus } from 'lucide-react';

interface QuickAddCardProps {
  groupId: string;
  room: string;
  onCreated: (item: SetupItem) => void;
}

export function QuickAddCard({ groupId, room, onCreated }: QuickAddCardProps) {
  const [name, setName] = useState('');

  const create = () => {
    const row = quickAddSetupItem(groupId, room, name);
    if (!row) return;
    // Offline-safe: hand the row to onCreated (-> writeRow), which writes to
    // the local store and syncs; writeRow stamps created_by.
    onCreated(row);
    setName(''); // ready for the next one
  };

  return (
    <div className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-border bg-card/20 px-3 py-1.5 focus-within:border-ring transition-colors">
      <Plus className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') create();
        }}
        onBlur={create}
        placeholder={`Add item to ${room}…`}
        className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground focus:outline-none"
      />
      {name.trim() && (
        <button
          onClick={create}
          className="-my-1.5 flex-shrink-0 px-2 py-2.5 text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50"
        >
          Add
        </button>
      )}
    </div>
  );
}
