"use client";

import { useEffect } from "react";
import { getEnabledSections, useModules } from "@homeup/core";
import { sectionIcons } from "@/lib/section-icons";
import { CheckCircle, ChevronRight } from "lucide-react";
import { LeadingTile } from "@/components/ui/leading-tile";
import {
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemLeading,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
} from "@/components/ui/list-item";

// One line on what a share becomes in each section.
const SHARE_HINT: Record<string, string> = {
  search: "Save a listing",
  setup: "Add something to buy or set up",
  household: "Add a task or reminder",
  calendar: "Add an event",
  groceries: "Add to the shopping list",
  documents: "File a document",
  costs: "Add a bill or cost",
};

interface ShareDestinationPickerProps {
  onSelect: (sectionId: string) => void;
  isLoading?: boolean;
}

export function ShareDestinationPicker({ onSelect, isLoading = false }: ShareDestinationPickerProps) {
  const modules = useModules();
  const enabledSections = getEnabledSections(modules.enabled).filter((s) => s.acceptsShares);

  // If only one section accepts shares, auto-select it
  useEffect(() => {
    if (enabledSections.length === 1) {
      onSelect(enabledSections[0].id);
    }
  }, [enabledSections, onSelect]);

  if (enabledSections.length === 1) {
    return (
      <main className="flex flex-col items-center justify-center min-h-screen p-6 gap-4">
        <CheckCircle className="h-10 w-10 text-success" />
        <p className="text-lg">Adding to {enabledSections[0].label}...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-8 pb-12">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-bold tracking-tight">Save to</h1>
        <p className="text-sm text-muted-foreground">Pick where this belongs.</p>
      </div>

      <ListGroup>
        {enabledSections.map((section) => {
          const Icon = sectionIcons[section.iconId];
          const hint = SHARE_HINT[section.id];
          return (
            <ListItem key={section.id} asChild className="gap-3 py-3">
              <button
                type="button"
                onClick={() => onSelect(section.id)}
                disabled={isLoading}
                className="w-full text-left disabled:opacity-50"
              >
                <ListItemLeading>
                  <LeadingTile sectionId={section.id} Icon={Icon} />
                </ListItemLeading>
                <ListItemContent>
                  <ListItemTitle>{section.label}</ListItemTitle>
                  {hint && <ListItemMeta>{hint}</ListItemMeta>}
                </ListItemContent>
                <ListItemTrailing>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </ListItemTrailing>
              </button>
            </ListItem>
          );
        })}
      </ListGroup>
    </main>
  );
}
