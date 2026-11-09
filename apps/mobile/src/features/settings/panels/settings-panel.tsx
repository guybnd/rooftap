// Hearth v2 settings panel shell (native twin of apps/web's
// components/settings-panel.tsx): one bordered rounded-3xl card per panel
// (H4), a header of a neutral 36px glyph tile + a Title-step name (+ optional
// trailing action), an optional muted description, then the body. Rows sit on
// an inset fill (`SettingsInset`), never a second border. Inside the Settings
// tabs (`SettingsTint`) the glyph tile wears the panel's own hue (core
// settingsPanelHue); in a module's settings sheet it stays neutral.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react-native';
import { Card, LeadingTile, ListGroup, ListItem, ListItemContent, ListItemLeading, ListItemTrailing, Switch, Text, cn, haptics } from '@homeup/ui';
import { settingsPanelHue, type SectionHue } from '@homeup/core';

/**
 * Settings tabs fold their panels (HOUP-616): inside a `SettingsFold` each
 * panel shows as its header row only, and one opens at a time under its
 * header. Module settings sheets and pages have no fold, so they show open.
 */
const FoldContext = React.createContext<{ open: string | null; toggle: (id: string) => void } | null>(null);

export function SettingsFold({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState<string | null>(null);
  const toggle = React.useCallback((id: string) => setOpen((cur) => (cur === id ? null : id)), []);
  const value = React.useMemo(() => ({ open, toggle }), [open, toggle]);
  // One group with hairlines between the folded rows (H4: one border level).
  return (
    <FoldContext.Provider value={value}>
      <Card className="gap-0 rounded-3xl py-0">
        {/* Every folded row draws its own top hairline; this hides the first. */}
        <View style={{ marginTop: -1 }}>{children}</View>
      </Card>
    </FoldContext.Provider>
  );
}

/** The Settings tabs colour each panel's tile (Guy, 2026-11-08: the tabs read drab). */
const TintContext = React.createContext(false);

export function SettingsTint({ children }: { children: React.ReactNode }) {
  return <TintContext.Provider value>{children}</TintContext.Provider>;
}

function PanelTile({ Icon, hue }: { Icon: LucideIcon; hue?: SectionHue }) {
  if (hue) return <LeadingTile hue={hue} Icon={Icon} size="md" />;
  return (
    <View className="size-9 items-center justify-center rounded-[11px] bg-muted">
      <Icon size={18} strokeWidth={2.1} className="text-muted-foreground" />
    </View>
  );
}

export function SettingsPanel({
  icon: Icon,
  title,
  description,
  summary,
  action,
  className,
  children,
}: {
  icon?: LucideIcon;
  /** A string renders at the Title step; pass a node for an editable title. */
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The current value, shown on the folded row (E2). */
  summary?: string | null;
  /** Right-aligned header control (e.g. "Add agent"). */
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const fold = React.useContext(FoldContext);
  const tint = React.useContext(TintContext);
  const id = React.useId();
  if (fold) {
    const open = fold.open === id;
    const label = typeof title === 'string' ? title : undefined;
    return (
      <View className={cn('border-t border-border', className)}>
        <Pressable
          onPress={() => {
            haptics.select();
            fold.toggle(id);
          }}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ expanded: open }}
          className="min-h-14 flex-row items-center gap-3 px-4 py-2.5 active:bg-accent/30"
        >
          {Icon && <PanelTile Icon={Icon} hue={tint && typeof title === 'string' ? settingsPanelHue(title) : undefined} />}
          <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
            {typeof title === 'string' ? (
              <Text numberOfLines={1} className="font-heading text-title font-semibold text-foreground">
                {title}
              </Text>
            ) : (
              title
            )}
          </View>
          {!!summary && !open && (
            <Text numberOfLines={1} className="max-w-[45%] text-caption text-muted-foreground">
              {summary}
            </Text>
          )}
          <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
            <ChevronDown size={16} className="text-muted-foreground" />
          </View>
        </Pressable>
        {open && (
          <View className="gap-4 px-4 pb-4">
            {(description || action) && (
              <View className="flex-row items-start gap-3">
                <View className="min-w-0 flex-1">
                  {typeof description === 'string' ? (
                    <Text className="text-body text-muted-foreground">{description}</Text>
                  ) : (
                    description
                  )}
                </View>
                {action}
              </View>
            )}
            {children}
          </View>
        )}
      </View>
    );
  }
  return (
    <Card className={cn('gap-4 rounded-3xl px-4', className)}>
      <View className="gap-2">
        <View className="min-h-9 flex-row items-center gap-3">
          {Icon && <PanelTile Icon={Icon} hue={tint && typeof title === 'string' ? settingsPanelHue(title) : undefined} />}
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
