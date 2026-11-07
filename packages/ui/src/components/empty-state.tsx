// HOUP-169: shared empty-state primitive per Hearth §11 ("Empty states:
// centered; icon in the section's tile; one headline, one short
// description, one CTA"). With first steps (children) it becomes the
// left-aligned "Try" layout of Hearth §13.9. Screens previously hand-rolled a dashed-border box
// per section (recipes, checklists) - a dashed border is its own H4
// violation (a second border level inside the screen) on top of drifting
// copy/spacing per screen.
import * as React from 'react';
import { Text, View, type ViewProps } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Button } from './button';
import { LeadingTile } from './leading-tile';
import { cn } from '../lib/cn';

export interface EmptyStateAction {
  label: string;
  onPress: () => void;
  /** Rendered before the label, e.g. `<Plus size={14} className="text-primary-foreground" />`. */
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface EmptyStateProps extends Omit<ViewProps, 'children'> {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Hearth §11: at most one CTA. Omit when the empty state has no action. */
  action?: EmptyStateAction;
  /** A de-emphasized alternate path (text link, not a competing button) —
   *  stays within Hearth §11's "one CTA" by never rendering as its own button. */
  secondaryAction?: EmptyStateAction;
  /** The section whose hue the tile wears. Defaults to the screen's own (SectionProvider). */
  sectionId?: string;
  /**
   * First steps under the words (Hearth §13.9 "Empty screens"): the app's
   * "Try" group. With them the empty state sits at the top, left-aligned,
   * like the Ask sheet's greeting, and takes no CTA of its own.
   */
  children?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action, secondaryAction, sectionId, children, className, ...props }: EmptyStateProps) {
  if (children) {
    return (
      <View className={cn('gap-4 pt-2', className)} {...props}>
        <View className="gap-2 px-0.5">
          <LeadingTile sectionId={sectionId} Icon={Icon} size="lg" />
          <Text className="font-heading text-[24px] font-bold leading-tight text-foreground">{title}</Text>
          <Text className="text-body leading-snug text-muted-foreground">{description}</Text>
        </View>
        {children}
      </View>
    );
  }
  return (
    <View className={cn('items-center gap-3 px-6 py-12', className)} {...props}>
      {/* Hearth §13.9: the tile wears the section's hue; coral stays on what you tap. */}
      <LeadingTile sectionId={sectionId} Icon={Icon} size="xl" />
      <View className="items-center gap-1">
        <Text className="font-heading text-title font-semibold text-foreground">{title}</Text>
        <Text className="max-w-[280px] text-center text-body text-muted-foreground">{description}</Text>
      </View>
      {action && (
        <Button size="sm" onPress={action.onPress} disabled={action.disabled} accessibilityLabel={action.label} className="mt-1">
          {action.icon}
          <Text className="text-sm font-medium text-primary-foreground">{action.label}</Text>
        </Button>
      )}
      {secondaryAction && (
        <Button
          variant="link"
          size="sm"
          onPress={secondaryAction.onPress}
          disabled={secondaryAction.disabled}
          accessibilityLabel={secondaryAction.label}
        >
          {secondaryAction.icon}
          <Text className="text-sm font-medium text-primary underline">{secondaryAction.label}</Text>
        </Button>
      )}
    </View>
  );
}
