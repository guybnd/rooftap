// The "Try" group on an empty module screen (Hearth §13.9 "Empty screens"):
// the screen's own add, the module's declared first steps (manifest
// `firstSteps`) and one Ask Rooftap starter while the Assistant is on (core
// emptyFirstSteps). It sits inside EmptyState as its children.
// Web twin: apps/web/src/components/first-steps.tsx.
import * as React from 'react';
import { View } from 'react-native';
import { ChevronRight, Plus, type LucideIcon } from 'lucide-react-native';
import { emptyFirstSteps, openAssistantPopup, useModules } from '@homeup/core';
import {
  LeadingTile,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemMeta,
  ListItemTitle,
  ListItemTrailing,
  Text,
  haptics,
} from '@homeup/ui';
import { sectionIconFor } from '@/lib/section-icons';
import { useOpenRoute } from '@/lib/tab-routes';
import { RooftapTile } from '@/components/brand/rooftap-mark';

export interface FirstStepAdd {
  label: string;
  meta?: string;
  onPress: () => void;
  /** Defaults to a plus in the module's tile. */
  icon?: LucideIcon;
  disabled?: boolean;
}

function Row({ lead, title, meta, onPress, disabled, trailing }: { lead: React.ReactNode; title: string; meta?: string; onPress: () => void; disabled?: boolean; trailing?: React.ReactNode }) {
  return (
    <ListItem
      onPress={() => {
        haptics.select();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      className={disabled ? 'items-center gap-3 opacity-50' : 'items-center gap-3'}
    >
      {lead}
      <ListItemContent>
        <ListItemTitle numberOfLines={2}>{title}</ListItemTitle>
        {meta ? (
          <ListItemMeta>
            <Text className="text-caption text-muted-foreground">{meta}</Text>
          </ListItemMeta>
        ) : null}
      </ListItemContent>
      <ListItemTrailing className="mt-0">{trailing ?? <ChevronRight size={16} className="text-muted-foreground" />}</ListItemTrailing>
    </ListItem>
  );
}

export function FirstSteps({ moduleId, add }: { moduleId: string; add?: FirstStepAdd }) {
  const modules = useModules();
  const openRoute = useOpenRoute();
  const { steps, ask } = React.useMemo(() => emptyFirstSteps(moduleId, (id) => modules.isEnabled(id)), [moduleId, modules]);
  if (!add && steps.length === 0 && !ask) return null;
  return (
    <View className="gap-2">
      <Text className="px-1 text-micro-label uppercase text-muted-foreground">Try</Text>
      <ListGroup>
        {add && (
          <Row
            lead={<LeadingTile sectionId={moduleId} Icon={add.icon ?? Plus} size="md" />}
            title={add.label}
            meta={add.meta}
            onPress={add.onPress}
            disabled={add.disabled}
          />
        )}
        {steps.map((s) => (
          <Row
            key={s.href}
            lead={<LeadingTile sectionId={s.module} Icon={sectionIconFor(s.module)} size="md" />}
            title={s.label}
            meta={s.meta}
            onPress={() => openRoute(s.href)}
          />
        ))}
        {ask && (
          <Row
            lead={<RooftapTile size="md" />}
            title={ask}
            meta="Ask Rooftap"
            onPress={() => {
              if (!openAssistantPopup({ ask })) openRoute(`/assistant/new?kind=quick&ask=${encodeURIComponent(ask)}`);
            }}
          />
        )}
      </ListGroup>
    </View>
  );
}
