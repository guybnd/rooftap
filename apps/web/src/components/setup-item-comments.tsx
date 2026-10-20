"use client";

import { EntityComments } from "@/components/entity-comments";

interface SetupItemCommentsProps {
  itemId: string;
  onChanged?: () => void;
}

export function SetupItemComments({ itemId, onChanged }: SetupItemCommentsProps) {
  return (
    <EntityComments
      table="setup_item_comments"
      fkColumn="setup_item_id"
      entityId={itemId}
      onChanged={onChanged}
    />
  );
}
