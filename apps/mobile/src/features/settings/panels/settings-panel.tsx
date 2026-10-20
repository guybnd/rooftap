// Hearth v2 settings panel shell (native twin of apps/web's
// components/settings-panel.tsx): one bordered rounded-3xl card per panel
// (H4), a header of a neutral 36px glyph tile + a Title-step name (+ optional
// trailing action), an optional muted description, then the body. Rows sit on
// an inset fill (`SettingsInset`), never a second border. The glyph tile is
// deliberately neutral: section identity hues belong to LeadingTile + the
// glow only (H2), and Settings is not a section.
import * as React from 'react';
import { View } from 'react-native';
import { Check, type LucideIcon } from 'lucide-react-native';
import { Card, ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemTrailing, Switch, Text, cn, haptics } from '@homeup/ui';

export function SettingsPanel({
  icon: Icon,
  title,
  description,
  action,
  className,
  children,
}: {
  icon?: LucideIcon;
  /** A string renders at the Title step; pass a node for an editable title. */
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned header control (e.g. "Add agent"). */
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className={cn('gap-4 rounded-3xl px-4', className)}>
      <View className="gap-2">
        <View className="min-h-9 flex-row items-center gap-3">
          {Icon && (
            <View className="size-9 items-center justify-center rounded-[11px] bg-muted">
              <Icon size={18} strokeWidth={2.1} className="text-muted-foreground" />
            </View>
          )}
          <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
            {typeof title === 'string' ? (
              <Text numberOfLines={1} className="font-heading text-title font-semibold text-foreground">
                {title}
              </Text>
            ) : (
              title
            )}
          </View>
          {action}
        </View>
        {typeof description === 'string' ? (
          <Text className="text-body text-muted-foreground">{description}</Text>
        ) : (
          description
        )}
      </View>
      {children}
    </Card>
  );
}

/** H4 inset group: the panel owns the border, rows sit on a fill with hairlines. */
export function SettingsInset({ className, ...props }: React.ComponentProps<typeof ListGroup>) {
  return <ListGroup bordered={false} className={cn('overflow-hidden rounded-xl bg-muted/30', className)} {...props} />;
}

/** Micro label heading a group inside a panel (T4: 10.5px, +0.1em). */
export function SettingsLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Text className={cn('px-1 text-micro-label uppercase text-muted-foreground', className)}>{children}</Text>;
}

/** An on/off setting: title + optional caption, the app's Switch trailing. Tapping the row flips it too. */
export function SettingsSwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  // The Switch fires its own select(); a tap on the row around it matches.
  return (
    <ListItem
      onPress={() => {
        haptics.select();
        onChange(!checked);
      }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityState={{ checked, disabled: !!disabled }}
      className={cn('min-h-[52px] items-center px-3.5', disabled && 'opacity-60')}
    >
      <ListItemContent>
        <Text className="text-sm font-medium text-foreground">{title}</Text>
        {description ? <Text className="text-caption text-muted-foreground">{description}</Text> : null}
      </ListItemContent>
      <ListItemTrailing>
        <Switch checked={checked} onChange={onChange} disabled={disabled} label={title} />
      </ListItemTrailing>
    </ListItem>
  );
}

/** One choice in a pick-one list (E3: selection = accent check). */
export function SettingsChoiceRow({
  selected,
  onSelect,
  leading,
  title,
  description,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  leading?: React.ReactNode;
  title: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <ListItem
      onPress={() => {
        if (!selected) haptics.select();
        onSelect();
      }}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ selected, disabled: !!disabled }}
      className={cn('min-h-[52px] items-center px-3.5', disabled && 'opacity-50')}
    >
      {leading ? <ListItemLeading className="mt-0">{leading}</ListItemLeading> : null}
      <ListItemContent>
        <Text className="text-sm font-medium text-foreground">{title}</Text>
        {description ? <Text className="text-caption text-muted-foreground">{description}</Text> : null}
      </ListItemContent>
      <ListItemTrailing>
        <View className={selected ? 'opacity-100' : 'opacity-0'}>
          <Check size={16} className="text-primary" />
        </View>
      </ListItemTrailing>
    </ListItem>
  );
}

/** The app's own checkbox (multi-select lists): a rounded box, accent when on. */
export function SettingsCheckbox({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <ListItem
      onPress={() => {
        haptics.tick();
        onChange();
      }}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      className={cn('min-h-11 items-center px-3.5 py-2', disabled && 'opacity-50')}
    >
      <View
        className={cn(
          'size-[18px] items-center justify-center rounded-[5px] border-2',
          checked ? 'border-primary bg-primary' : 'border-border'
        )}
      >
        {checked && <Check size={12} strokeWidth={3} className="text-primary-foreground" />}
      </View>
      <ListItemContent>{children}</ListItemContent>
    </ListItem>
  );
}

/** "Saving…" whisper for debounce-saved fields. */
export function SavingHint({ show }: { show: boolean }) {
  if (!show) return null;
  return <Text className="px-1 text-caption text-muted-foreground">Saving…</Text>;
}
