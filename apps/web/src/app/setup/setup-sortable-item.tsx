'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, GripVertical } from 'lucide-react';
import type { SetupItem, SetupStore } from '@homeup/core';
import { SetupItemCard, type CommentSummary, type SetupDocLink } from './setup-item-card';

interface SortableSetupItemProps {
  item: SetupItem;
  commentSummary?: CommentSummary;
  docLink?: SetupDocLink;
  groupId: string;
  stores: SetupStore[];
  selectMode?: boolean;
  /** Reorder mode: the drag handle shows and dragging is on (Hearth §6: the handle only appears in reorder mode). */
  reorderMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (itemId: string) => void;
  onUpdate: (item: SetupItem) => void;
  onDelete: (itemId: string) => void;
  onEdit: (item: SetupItem) => void;
  onCommentsChanged?: () => void;
  onStoreCreated?: (store: SetupStore) => void;
}

export function SortableSetupItem({
  selectMode,
  reorderMode,
  selected,
  onToggleSelect,
  ...props
}: SortableSetupItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.id,
    disabled: !reorderMode, // dragging only in reorder mode
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  // Leading slot: a round selection mark in bulk mode (round, so it never
  // reads as the square status box it stands in for; mirrors mobile), the
  // drag handle in reorder mode, otherwise the row's own status checkbox.
  const leading = selectMode ? (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!selected}
      aria-label="Select item"
      onClick={() => onToggleSelect?.(props.item.id)}
      className="-m-2.5 flex flex-shrink-0 cursor-pointer items-center justify-center p-2.5"
    >
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
        }`}
      >
        {selected && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
    </button>
  ) : reorderMode ? (
    <button
      {...attributes}
      {...listeners}
      className="-m-2 flex-shrink-0 cursor-grab touch-none p-2 text-muted-foreground hover:text-foreground active:cursor-grabbing"
      title="Drag to reorder"
      aria-label="Drag to reorder"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  ) : null;

  return (
    <div ref={setNodeRef} style={style}>
      <SetupItemCard {...props} selected={selected} dragHandle={leading} />
    </div>
  );
}
