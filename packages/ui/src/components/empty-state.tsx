// HOUP-169: shared empty-state primitive per Hearth §11 ("Empty states:
// centered; icon in rounded-2xl bg-primary/10 p-5; one headline, one short
// description, one CTA"). Screens previously hand-rolled a dashed-border box
// per section (recipes, checklists) - a dashed border is its own H4
// violation (a second border level inside the screen) on top of drifting
// copy/spacing per screen.
import * as React from 'react';
import { Text, View, type ViewProps } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Button } from './button';
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
}

export function EmptyState({ icon: Icon, title, description, action, secondaryAction, className, ...props }: EmptyStateProps) {
  return (
    <View className={cn('items-center gap-3 px-6 py-12', className)} {...props}>
      <View className="items-center justify-center rounded-2xl bg-primary/10 p-5">
        <Icon size={28} className="text-primary" />
      </View>
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
