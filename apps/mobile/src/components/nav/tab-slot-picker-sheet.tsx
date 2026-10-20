// Long-press a tab to choose what sits in its slot (web twin:
// apps/web/src/components/section-switcher.tsx's TabSlotPickerSheet). Lists
// every section the household has on, in the bar's order, so a hidden one
// can be brought back too; core assignTabSlot() decides the swap.
import { View } from 'react-native';
import { Check } from 'lucide-react-native';
import {
  Text,
  BottomSheet,
  LeadingTile,
  ListGroup,
  ListItem,
  ListItemContent,
  ListItemTitle,
  ListItemTrailing,
  haptics,
} from '@homeup/ui';
import type { Section } from '@homeup/core';
import { sectionIcons } from '@/lib/section-icons';

export interface TabSlotPickerSheetProps {
  /** The section whose tab was held; null = closed. */
  slot: Section | null;
  onClose: () => void;
  /** Every enabled section, in the saved order. */
  sections: Section[];
  barSectionIds: ReadonlySet<string>;
  hiddenSectionIds: ReadonlySet<string>;
  onChoose: (section: Section) => void;
}

export function TabSlotPickerSheet({
  slot,
  onClose,
  sections,
  barSectionIds,
  hiddenSectionIds,
  onChoose,
}: TabSlotPickerSheetProps) {
  return (
    <BottomSheet open={!!slot} onOpenChange={(open) => !open && onClose()} className="pb-4">
      <View className="px-4 pb-2">
        <Text className="text-title font-medium text-foreground">Choose a tab</Text>
        {slot && (
          <Text className="text-caption text-muted-foreground">In place of {slot.label}</Text>
        )}
      </View>
      <ListGroup className="mx-3 border-0 bg-transparent">
        {sections.map((section) => {
          const Icon = sectionIcons[section.iconId];
          const here = section.id === slot?.id;
          const note = here
            ? null
            : barSectionIds.has(section.id)
              ? 'In bar'
              : hiddenSectionIds.has(section.id)
                ? 'Hidden'
                : null;
          return (
            <ListItem
              key={section.id}
              onPress={() => {
                if (!here) haptics.select();
                onChoose(section);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: here }}
              accessibilityLabel={note ? `${section.label}, ${note.toLowerCase()}` : section.label}
              className="items-center"
            >
              {Icon && <LeadingTile sectionId={section.id} Icon={Icon} size="sm" />}
              <ListItemContent>
                <ListItemTitle className={here ? 'font-semibold' : undefined}>{section.label}</ListItemTitle>
              </ListItemContent>
              {(here || note) && (
                <ListItemTrailing>
                  {here ? (
                    <Check size={18} className="text-primary" />
                  ) : (
                    <Text className="text-caption text-muted-foreground">{note}</Text>
                  )}
                </ListItemTrailing>
              )}
            </ListItem>
          );
        })}
      </ListGroup>
    </BottomSheet>
  );
}
