// HOUP-122: native port of apps/web/src/app/tasks/page.tsx's header `PopMenu`
// (Refresh + Generate moving tasks). Web's PopMenu is web-local
// (apps/web/src/app/setup/pop-menu.tsx); `packages/ui` has no menu/popover
// primitive, so this reuses the existing `@homeup/ui` `BottomSheet` as a
// header action sheet instead of adding a new primitive for two actions —
// same substitution task-quick-menu.tsx already makes for the per-row menu.
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { RotateCw, Settings, Sparkles } from 'lucide-react-native';
import { Text, BottomSheet } from '@homeup/ui';

function ActionRow({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="menuitem"
      disabled={disabled}
      onPress={onPress}
      className="flex-row items-center gap-2.5 rounded-lg px-3 py-2.5"
      style={disabled ? { opacity: 0.5 } : undefined}
    >
      {icon}
      <Text className="text-body text-foreground">{label}</Text>
    </Pressable>
  );
}

export interface TasksActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  onGenerate: () => void;
  isGenerating: boolean;
  /** False when no move-in date is set, or the move is long past. */
  movingActive: boolean;
  /** "Tasks & Reminders settings" (module-settings.ts), or null when there is nothing to set. */
  settings: { label: string; open: () => void } | null;
}

export function TasksActionSheet({ open, onOpenChange, onRefresh, onGenerate, isGenerating, movingActive, settings }: TasksActionSheetProps) {
  const close = () => onOpenChange(false);

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <View className="gap-1 px-3 pb-2">
        <ActionRow
          icon={<RotateCw size={16} className="text-muted-foreground" />}
          label="Refresh"
          onPress={() => {
            close();
            onRefresh();
          }}
        />
        {movingActive && (
          <ActionRow
            icon={<Sparkles size={16} className="text-muted-foreground" />}
            label={isGenerating ? 'Generating…' : 'Generate moving tasks'}
            disabled={isGenerating}
            onPress={() => {
              close();
              onGenerate();
            }}
          />
        )}
        {settings && (
          <ActionRow
            icon={<Settings size={16} className="text-muted-foreground" />}
            label={settings.label}
            onPress={() => {
              close();
              settings.open();
            }}
          />
        )}
      </View>
    </BottomSheet>
  );
}
