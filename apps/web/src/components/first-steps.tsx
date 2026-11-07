'use client';

// The "Try" group on an empty module screen (Hearth §13.9 "Empty screens"):
// the screen's own add, the module's declared first steps (manifest
// `firstSteps`) and one Ask Rooftap starter while the Assistant is on (core
// emptyFirstSteps). It sits inside EmptyState as its children.
// Native twin: apps/mobile/src/components/first-steps.tsx.
import { useMemo, type ComponentType, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus } from 'lucide-react';
import { emptyFirstSteps, openAssistantPopup, useModules } from '@homeup/core';
import { LeadingTile } from '@/components/ui/leading-tile';
import { ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemMeta, ListItemTitle, ListItemTrailing } from '@/components/ui/list-item';
import { RooftapTile } from '@/components/brand/rooftap-mark';
import { sectionIconFor } from '@/lib/section-icons';

export interface FirstStepAdd {
  label: string;
  meta?: string;
  onClick: () => void;
  /** Defaults to a plus in the module's tile. */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  disabled?: boolean;
}

function Row({ lead, title, meta, onClick, disabled }: { lead: ReactNode; title: string; meta?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <ListItem asChild>
      <button type="button" onClick={onClick} disabled={disabled} className="w-full items-center text-left hover:bg-muted/60 disabled:opacity-50">
        <ListItemLeading className="mt-0">{lead}</ListItemLeading>
        <ListItemContent>
          <ListItemTitle className="line-clamp-2 block whitespace-normal">{title}</ListItemTitle>
          {meta && <ListItemMeta>{meta}</ListItemMeta>}
        </ListItemContent>
        <ListItemTrailing>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </ListItemTrailing>
      </button>
    </ListItem>
  );
}

export function FirstSteps({ moduleId, add }: { moduleId: string; add?: FirstStepAdd }) {
  const modules = useModules();
  const router = useRouter();
  const { steps, ask } = useMemo(() => emptyFirstSteps(moduleId, (id) => modules.isEnabled(id)), [moduleId, modules]);
  if (!add && steps.length === 0 && !ask) return null;
  return (
    <div className="space-y-2">
      <p className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Try</p>
      <ListGroup>
        {add && (
          <Row
            lead={<LeadingTile sectionId={moduleId} Icon={add.icon ?? Plus} size="md" />}
            title={add.label}
            meta={add.meta}
            onClick={add.onClick}
            disabled={add.disabled}
          />
        )}
        {steps.map((s) => (
          <Row key={s.href} lead={<LeadingTile sectionId={s.module} Icon={sectionIconFor(s.module)} size="md" />} title={s.label} meta={s.meta} onClick={() => router.push(s.href)} />
        ))}
        {ask && (
          <Row
            lead={<RooftapTile size="md" />}
            title={ask}
            meta="Ask Rooftap"
            onClick={() => {
              if (!openAssistantPopup({ ask })) router.push(`/assistant/new?kind=quick&ask=${encodeURIComponent(ask)}`);
            }}
          />
        )}
      </ListGroup>
    </div>
  );
}
