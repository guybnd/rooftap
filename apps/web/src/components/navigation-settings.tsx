"use client";

import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { useSectionSettings } from "@/lib/use-section";
import { getEnabledSections, getSectionByPath, orderSections, useModules, type Section } from "@homeup/core";
import { sectionIcons } from "@/lib/section-icons";
import { SettingsPanel } from "@/components/settings-panel";
import { Switch } from "@/components/ui/switch";
import {
  ListItem,
  ListGroup,
  ListItemLeading,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
} from "@/components/ui/list-item";
import { GripVertical, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * FLUX-65 + FLUX-165: whole-section visibility and per-user ordering.
 * - Drag the grip handle to reorder sections; the saved order drives the sidebar
 *   switcher (desktop grid + mobile tab bar, where the first 3 *visible* sections
 *   become the primary tabs and the rest fall under "More" — except when exactly
 *   4 sections are visible, in which case all 4 render inline with no "More" tab).
 * - Toggling a section off removes it from the switcher for this user. Two guards
 *   (FLUX-65 AC#5): the active section is always shown by the sidebar even if
 *   marked hidden, and the panel disables the toggle that would hide the last one.
 */
export function NavigationSettings() {
  const pathname = usePathname();
  const { settings, loading, updateHiddenSections, updateSectionOrder } = useSectionSettings();
  // Only modules the household has on; switched-off ones live in Settings > Modules.
  const modules = useModules();

  const hidden = settings.hiddenSections ?? [];
  const currentSection = getSectionByPath(pathname);
  // Apply the saved order here too, so the Settings list matches the sidebar.
  const orderedSections = orderSections(getEnabledSections(modules.enabled), settings.sectionOrder ?? []);
  const visibleSections = orderedSections.filter((s) => !hidden.includes(s.id));
  const visibleCount = visibleSections.length;
  // The mobile bar shows the first 3 *visible* sections as primary tabs, with the
  // rest under "More" — except exactly 4 visible sections render all 4 inline
  // with no "More" tab (a single-item More sheet would be pointless). Mark the
  // boundary with a divider so the user sees the consequence of the order (only
  // meaningful when more than 4 are visible).
  const lastPrimaryVisibleId = visibleCount > 4 ? visibleSections[2]?.id : undefined;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const toggle = (id: string, isHidden: boolean) => {
    const next = isHidden ? hidden.filter((h) => h !== id) : [...hidden, id];
    updateHiddenSections(next);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = orderedSections.map((s) => s.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    updateSectionOrder(arrayMove(ids, oldIndex, newIndex));
  };

  return (
    <SettingsPanel
      icon={Navigation}
      title="Navigation"
      description="Drag to reorder, or switch off sections you don't use. On a phone the first four sit in the tab bar and the rest under More; hold a tab to choose what sits there. Hidden sections stay reachable here."
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={orderedSections.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          {/* Hearth H4: the panel already owns this view's one border level,
              so the section list here is the inset FILL (no second border):
              ListGroup's own border/shadow/bg-card are overridden. */}
          <ListGroup className="rounded-xl border-0 bg-muted/30 shadow-none divide-border/60">
            {orderedSections.map((section) => {
              const isHidden = hidden.includes(section.id);
              const isCurrent = section.id === currentSection.id;
              // Can't hide the last remaining visible section.
              const blockHide = !isHidden && visibleCount <= 1;
              return (
                <Fragment key={section.id}>
                  <SortableSectionRow
                    section={section}
                    isHidden={isHidden}
                    isCurrent={isCurrent}
                    blockHide={blockHide}
                    loading={loading}
                    onToggle={() => toggle(section.id, isHidden)}
                  />
                  {section.id === lastPrimaryVisibleId && (
                    <div
                      className="flex items-center gap-2 px-3.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground select-none"
                      aria-hidden="true"
                    >
                      <span className="h-px flex-1 bg-border" />
                      Under More on a phone
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  )}
                </Fragment>
              );
            })}
          </ListGroup>
        </SortableContext>
      </DndContext>
    </SettingsPanel>
  );
}

interface SortableSectionRowProps {
  section: Section;
  isHidden: boolean;
  isCurrent: boolean;
  blockHide: boolean;
  loading: boolean;
  onToggle: () => void;
}

function SortableSectionRow({
  section,
  isHidden,
  isCurrent,
  blockHide,
  loading,
  onToggle,
}: SortableSectionRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
    disabled: loading,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const SectionIcon = sectionIcons[section.iconId];

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      className={cn(
        "min-h-[52px] gap-2 py-2 pl-1.5 pr-3.5",
        isHidden && "text-muted-foreground",
        isDragging && "relative z-10 bg-background shadow-md ring-1 ring-border"
      )}
    >
      <ListItemLeading className="gap-1.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={loading}
          aria-label={`Reorder ${section.label}`}
          title="Drag to reorder"
          className={cn(
            "flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing",
            loading && "cursor-not-allowed opacity-40"
          )}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <SectionIcon className="h-4 w-4 shrink-0" />
      </ListItemLeading>
      <ListItemContent>
        <ListItemTitle className={cn(isHidden && "text-muted-foreground")}>{section.label}</ListItemTitle>
        {isHidden && isCurrent && <ListItemMeta>Still shown while you&apos;re in it</ListItemMeta>}
      </ListItemContent>
      <ListItemTrailing>
        <Switch
          checked={!isHidden}
          onChange={onToggle}
          disabled={loading || blockHide}
          label={blockHide ? "At least one section must stay visible" : `Show ${section.label}`}
        />
      </ListItemTrailing>
    </ListItem>
  );
}
