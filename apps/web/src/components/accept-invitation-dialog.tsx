"use client";

import { useState } from "react";
import { use$ } from "@legendapp/state/react";
import { createClient } from "@/lib/supabase/client";
import { useDataCache } from "@/lib/data-cache";
import { apartments$, agents$, apartmentChecklistItems$, savedSearches$, useReconnectSync } from "@homeup/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ArrowRightLeftIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { Agent, Apartment, ChecklistItem, GroupInvitation, SavedSearch } from '@homeup/core';

export function AcceptInvitationDialog({
  invitation,
  open,
  onClose,
}: {
  invitation: GroupInvitation;
  open: boolean;
  onClose: () => void;
}) {
  const [processing, setProcessing] = useState(false);
  const { group, refresh } = useDataCache();

  const apts$ = apartments$(group?.id);
  const agentsStore$ = agents$(group?.id);
  const checklistItemsStore$ = apartmentChecklistItems$(group?.id);
  const savedSearchesStore$ = savedSearches$(group?.id);
  useReconnectSync(apts$);
  useReconnectSync(agentsStore$);
  useReconnectSync(checklistItemsStore$);
  useReconnectSync(savedSearchesStore$);
  const apartments = use$(() =>
    Object.values(apts$.get() ?? {}).filter((a): a is Apartment => !!a && !a.deleted)
  );
  const agents = use$(() =>
    Object.values(agentsStore$.get() ?? {}).filter((a): a is Agent => !!a && !a.deleted)
  );
  const checklistItems = use$(() =>
    Object.values(checklistItemsStore$.get() ?? {}).filter((c): c is ChecklistItem => !!c && !c.deleted)
  );
  const savedSearches = use$(() =>
    Object.values(savedSearchesStore$.get() ?? {}).filter((s): s is SavedSearch => !!s && !s.deleted)
  );

  const handleAccept = async (mode: "merge" | "abandon") => {
    setProcessing(true);
    const supabase = createClient();
    const rpcName = mode === "merge" ? "accept_invitation_merge" : "accept_invitation_abandon";
    const { error } = await supabase.rpc(rpcName, { invitation_id: invitation.id });
    if (error) {
      toast.error("Failed to accept invitation");
      setProcessing(false);
      return;
    }
    toast.success(mode === "merge" ? "Data merged into new group!" : "Joined new group!");
    await refresh();
    onClose();
    setProcessing(false);
  };

  const dataCount = apartments.length + agents.length + checklistItems.length + savedSearches.length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Join {invitation.group_name ?? "Group"}</DialogTitle>
          <DialogDescription>
            Choose how to handle your existing data ({dataCount} item{dataCount !== 1 ? "s" : ""}).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <button
            type="button"
            disabled={processing}
            onClick={() => handleAccept("merge")}
            className="w-full rounded-lg border border-primary/30 bg-primary/5 p-3 text-left transition-colors hover:bg-primary/10 disabled:opacity-50"
          >
            <div className="flex items-center gap-2 font-medium text-sm">
              <ArrowRightLeftIcon className="h-4 w-4 text-primary" />
              Merge Data
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Move all your apartments ({apartments.length}), agents ({agents.length}), checklist items ({checklistItems.length}), and saved searches ({savedSearches.length}) into the new group.
            </p>
          </button>

          <button
            type="button"
            disabled={processing}
            onClick={() => handleAccept("abandon")}
            className="w-full rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-left transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            <div className="flex items-center gap-2 font-medium text-sm">
              <Trash2Icon className="h-4 w-4 text-destructive" />
              Start Fresh
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Delete all your existing data and join the group with a clean slate. This cannot be undone.
            </p>
          </button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={processing}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
