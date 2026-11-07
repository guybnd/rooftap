// The first-run screens' shared parts (Hearth §13.12): the Rooftap lede over
// a soft spectrum wash, the server as a small chip you can change, and fields
// stacked in one group with hairlines between them. Used by sign-in, the
// server picker and the no-household screen. Web twin:
// apps/web/src/components/first-run.tsx.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Server } from 'lucide-react-native';
import { Text, cn, haptics } from '@homeup/ui';
import { RooftapHero } from '@/components/brand/rooftap-mark';

/** The mark, a headline and one line under it, then anything else that belongs to the lede (the server chip). */
export function FirstRunHeader({ title, lede, children }: { title: string; lede: string; children?: React.ReactNode }) {
  return (
    <View className="items-center gap-2">
      <RooftapHero />
      <Text className="text-center font-heading text-[26px] font-bold leading-tight text-foreground" accessibilityRole="header">
        {title}
      </Text>
      <Text className="max-w-xs text-center text-body text-muted-foreground">{lede}</Text>
      {children}
    </View>
  );
}

/** Which server you are signing in to, with Change. */
export function ServerChip({ label, onChange }: { label: string; onChange: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        onChange();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Change server`}
      hitSlop={8}
      className="mt-1 flex-row items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 active:opacity-70"
    >
      <Server size={13} className="text-muted-foreground" />
      <Text className="max-w-[200px] text-caption text-muted-foreground" numberOfLines={1}>
        {label}
      </Text>
      <Text className="text-caption font-medium text-primary">Change</Text>
    </Pressable>
  );
}

/** Fields as one group: one border round the lot, hairlines between. Give each field FieldGroup.input. */
export function FieldGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View className={cn('overflow-hidden rounded-2xl border border-border bg-card', className)}>
      {items.map((child, i) => (
        <React.Fragment key={i}>
          {i > 0 && <View className="ml-4 h-px bg-border" />}
          {child}
        </React.Fragment>
      ))}
    </View>
  );
}
FieldGroup.input = 'h-12 rounded-none border-0 bg-transparent px-4 focus:border-0';
